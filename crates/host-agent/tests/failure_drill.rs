//! Failure drill: what a storage product does when things go wrong.
//!
//! The audit's phrasing was "the failure matrix that matters for a storage product has not
//! been exercised". These are the cases from it that can be provoked deterministically in a
//! test. Each asserts the same property: the host must FAIL, and must not silently lose or
//! corrupt data, and must still be usable afterwards.
//!
//! Not covered here, and honestly out of reach of a unit test: a real power cut mid-write,
//! and a genuinely full physical disk. Those need the hardware drill in
//! `docs/failure-drill.md`.

use core_proto::{FilePayload, Request, Response};
use host_agent::{HostAgent, HostConfig};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(1);

/// A scratch data dir per case, matching how the crate's own tests do it (no tempfile dep).
fn scratch() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("pc-drill-{}-{}", std::process::id(), n));
    let _ = std::fs::remove_dir_all(&d);
    d
}

fn agent(dir: &std::path::Path, quota: u64) -> HostAgent {
    HostAgent::init(HostConfig { data_dir: dir.to_path_buf(), quota_bytes: quota }).unwrap()
}

fn payload(len: usize) -> FilePayload {
    FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: len as u64, ciphertext: vec![7u8; len + 16] }
}

/// Quota exhaustion must refuse the write, not accept a truncated one, and must leave the
/// store usable. A storage product that half-writes a file when full is worse than one that
/// says no.
#[test]
fn a_full_partition_refuses_writes_and_stays_usable() {
    let dir = scratch();
    let a = agent(&dir, 4096);

    // Fits.
    match a.handle(Request::PutFile { parent: "/".into(), name: "small.bin".into(), payload: payload(1000) }) {
        Response::Ok | Response::Entry(_) => {}
        other => panic!("small write should succeed, got {other:?}"),
    }
    // Does not fit.
    let big = a.handle(Request::PutFile { parent: "/".into(), name: "big.bin".into(), payload: payload(100_000) });
    assert!(matches!(big, Response::QuotaExceeded { .. } | Response::Error { .. }), "an over-quota write must be refused, got {big:?}");

    // The refusal must not have left a partial entry behind.
    match a.handle(Request::ListDir { path: "/".into() }) {
        Response::DirListing(d) => {
            assert!(d.entries.iter().any(|e| e.name == "small.bin"), "the earlier file vanished");
            assert!(!d.entries.iter().any(|e| e.name == "big.bin"), "a refused write left a ghost entry");
        }
        other => panic!("unexpected {other:?}"),
    }
    // And the store still works afterwards.
    match a.handle(Request::PutFile { parent: "/".into(), name: "after.bin".into(), payload: payload(500) }) {
        Response::Ok | Response::Entry(_) => {}
        other => panic!("store unusable after a refused write: {other:?}"),
    }
}

/// The earlier file must still read back byte-for-byte after a refused write. Quota accounting
/// that corrupts existing data would be the worst possible failure here.
#[test]
fn existing_files_survive_a_refused_write() {
    let dir = scratch();
    let a = agent(&dir, 8192);
    let body = payload(2000);
    let want = body.ciphertext.clone();
    a.handle(Request::PutFile { parent: "/".into(), name: "keep.bin".into(), payload: body });
    let _ = a.handle(Request::PutFile { parent: "/".into(), name: "toobig.bin".into(), payload: payload(1_000_000) });

    match a.handle(Request::ReadFile { id: "/keep.bin".into() }) {
        Response::File(p) => assert_eq!(p.ciphertext, want, "an existing file changed after a refused write"),
        other => panic!("unexpected {other:?}"),
    }
}

/// Two writers, same path. Last-write-wins is an acceptable policy; silently keeping neither,
/// or leaving the entry pointing at bytes from the other write, is not.
#[test]
fn two_writes_to_one_path_leave_exactly_one_coherent_file() {
    let dir = scratch();
    let a = agent(&dir, 1024 * 1024);

    let mut first = payload(300);
    first.ciphertext = vec![1u8; 316];
    let mut second = payload(300);
    second.ciphertext = vec![2u8; 316];

    a.handle(Request::PutFile { parent: "/".into(), name: "race.bin".into(), payload: first });
    a.handle(Request::PutFile { parent: "/".into(), name: "race.bin".into(), payload: second.clone() });

    match a.handle(Request::ListDir { path: "/".into() }) {
        Response::DirListing(d) => {
            let n = d.entries.iter().filter(|e| e.name == "race.bin").count();
            assert_eq!(n, 1, "two writes to one path produced {n} entries");
        }
        other => panic!("unexpected {other:?}"),
    }
    // Whichever won, the bytes must be ONE of the two writes in full, never a blend.
    match a.handle(Request::ReadFile { id: "/race.bin".into() }) {
        Response::File(p) => {
            let all_same = p.ciphertext.iter().all(|b| *b == p.ciphertext[0]);
            assert!(all_same, "the stored file blends bytes from both writes");
            assert_eq!(p.ciphertext.len(), 316, "the stored file is a truncated mix");
        }
        other => panic!("unexpected {other:?}"),
    }
}

/// A corrupt metadata database must be reported, not silently treated as an empty drive.
/// "Your files are all gone" is the single worst thing this product could say incorrectly.
#[test]
fn a_corrupt_metadata_db_fails_loudly_rather_than_reading_as_empty() {
    let dir = scratch();
    {
        let a = agent(&dir, 1024 * 1024);
        a.handle(Request::PutFile { parent: "/".into(), name: "precious.bin".into(), payload: payload(400) });
    }

    // Find the metadata db and scribble over its header.
    let db = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().map(|x| x == "db").unwrap_or(false))
        .expect("a metadata db should exist");
    std::fs::write(&db, b"this is not a sqlite file, not even slightly").unwrap();

    // Opening it must be an error. It must NOT come back as a working, empty store, which
    // would let a client conclude the account has no files and act on that.
    let opened = HostAgent::open(HostConfig { data_dir: dir.clone(), quota_bytes: 0 });
    assert!(opened.is_err(), "a corrupt metadata db opened successfully and would read as empty");
}

/// Account-key rotation: the host must swap a file's wrapped key without touching its bytes.
/// If rotation altered the ciphertext, every rotation would be a chance to corrupt the whole
/// drive, which is the reason it re-wraps keys rather than re-encrypting content.
#[test]
fn rewrapping_a_key_leaves_the_ciphertext_untouched() {
    let dir = scratch();
    let a = agent(&dir, 1024 * 1024);
    let body = payload(600);
    let want_ct = body.ciphertext.clone();
    let old_wrap = body.wrapped_ck.clone();
    a.handle(Request::PutFile { parent: "/".into(), name: "f.bin".into(), payload: body });

    let new_wrap = b"a-different-wrapping".to_vec();
    assert!(matches!(
        a.handle(Request::RewrapKey { id: "/f.bin".into(), wrapped_ck: new_wrap.clone() }),
        Response::Ok
    ));

    match a.handle(Request::ReadFile { id: "/f.bin".into() }) {
        Response::File(p) => {
            assert_eq!(p.ciphertext, want_ct, "rotation altered the file's ciphertext");
            assert_eq!(p.wrapped_ck, new_wrap, "the new wrapping was not stored");
            assert_ne!(p.wrapped_ck, old_wrap, "the old wrapping survived");
        }
        other => panic!("unexpected {other:?}"),
    }
}

/// Rewrapping something that does not exist must fail rather than silently succeed: a
/// rotation that reports success over a missing file would leave a gap nobody notices.
#[test]
fn rewrapping_a_missing_file_is_an_error() {
    let dir = scratch();
    let a = agent(&dir, 1024 * 1024);
    let r = a.handle(Request::RewrapKey { id: "/nope.bin".into(), wrapped_ck: b"x".to_vec() });
    assert!(matches!(r, Response::Error { .. }), "rewrapping a missing file reported {r:?}");
}
