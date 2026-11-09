//! End-to-end WebDAV test: drive the real server over HTTP with the WebDAV verbs
//! a client (incl. macOS Finder) uses — MKCOL / PUT / GET / PROPFIND / MOVE /
//! DELETE — and assert (a) byte-exact round-trips and (b) that file *plaintext*
//! never reaches disk (E2EE preserved through the mount).

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use core_crypto::AccountRootKey;
use core_fs::Store;
use core_webdav::{Drive, LocalDrive, WebdavFs};
use dav_server::{fakels::FakeLs, DavHandler};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

async fn spawn_server(data: PathBuf) -> String {
    std::fs::create_dir_all(&data).unwrap();
    let store = Store::open(&data.join("meta.db"), &data.join("blobs")).unwrap();
    store.set_quota(1 << 30).unwrap(); // 1 GiB
    let drive: Arc<dyn Drive> = Arc::new(LocalDrive::new(store, AccountRootKey::generate()));
    let dav = DavHandler::builder()
        .filesystem(WebdavFs::new(drive))
        .locksystem(FakeLs::new())
        .build_handler();

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let dav = dav.clone();
            let io = TokioIo::new(stream);
            tokio::spawn(async move {
                let svc = service_fn(move |req| {
                    let dav = dav.clone();
                    async move { Ok::<_, Infallible>(dav.handle(req).await) }
                });
                let _ = http1::Builder::new().serve_connection(io, svc).await;
            });
        }
    });
    format!("http://{addr}")
}

fn method(m: &str) -> reqwest::Method {
    reqwest::Method::from_bytes(m.as_bytes()).unwrap()
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[tokio::test]
async fn webdav_crud_roundtrip_and_ciphertext_at_rest() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("drive");
    let base = spawn_server(data.clone()).await;
    let http = reqwest::Client::new();

    let marker = "SUPERSECRET_PLAINTEXT_MARKER_9f3a";
    let body = format!("hello webdav :: {marker}").into_bytes();

    // MKCOL /Docs
    let r = http.request(method("MKCOL"), format!("{base}/Docs")).send().await.unwrap();
    assert!(r.status().is_success(), "MKCOL -> {}", r.status());

    // PUT /Docs/note.txt
    let r = http.put(format!("{base}/Docs/note.txt")).body(body.clone()).send().await.unwrap();
    assert!(r.status().is_success(), "PUT -> {}", r.status());

    // GET it back byte-for-byte
    let r = http.get(format!("{base}/Docs/note.txt")).send().await.unwrap();
    assert!(r.status().is_success(), "GET -> {}", r.status());
    assert_eq!(r.bytes().await.unwrap().as_ref(), body.as_slice(), "GET body mismatch");

    // PROPFIND depth 1 lists the child
    let r = http
        .request(method("PROPFIND"), format!("{base}/Docs"))
        .header("Depth", "1")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 207, "PROPFIND -> {}", r.status());
    assert!(r.text().await.unwrap().contains("note.txt"), "PROPFIND missing child");

    // MOVE /Docs/note.txt -> /Docs/renamed.txt
    let r = http
        .request(method("MOVE"), format!("{base}/Docs/note.txt"))
        .header("Destination", format!("{base}/Docs/renamed.txt"))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success(), "MOVE -> {}", r.status());
    let r = http.get(format!("{base}/Docs/note.txt")).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 404, "old path should be gone");
    let r = http.get(format!("{base}/Docs/renamed.txt")).send().await.unwrap();
    assert_eq!(r.bytes().await.unwrap().as_ref(), body.as_slice(), "moved body mismatch");

    // E2EE at rest: the plaintext marker must appear in NO file on disk.
    let leaked = walk(&data)
        .iter()
        .filter_map(|p| std::fs::read(p).ok())
        .any(|bytes| contains(&bytes, marker.as_bytes()));
    assert!(!leaked, "plaintext leaked to disk — E2EE broken through the mount");

    // DELETE
    let r = http.request(method("DELETE"), format!("{base}/Docs/renamed.txt")).send().await.unwrap();
    assert!(r.status().is_success(), "DELETE -> {}", r.status());
    let r = http.get(format!("{base}/Docs/renamed.txt")).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 404, "deleted file still readable");
}

#[tokio::test]
async fn spawn_server_helper_serves() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::open(&tmp.path().join("m.db"), &tmp.path().join("blobs")).unwrap();
    store.set_quota(1 << 30).unwrap();
    let drive: Arc<dyn Drive> = Arc::new(LocalDrive::new(store, AccountRootKey::generate()));
    let (addr, _h) =
        core_webdav::spawn_server(drive, ([127, 0, 0, 1], 0).into(), false).await.unwrap();
    let base = format!("http://{addr}");
    let http = reqwest::Client::new();

    let r = http.put(format!("{base}/hello.txt")).body(b"hi via spawn_server".to_vec()).send().await.unwrap();
    assert!(r.status().is_success(), "PUT -> {}", r.status());
    let r = http.get(format!("{base}/hello.txt")).send().await.unwrap();
    assert_eq!(r.bytes().await.unwrap().as_ref(), b"hi via spawn_server");
}

#[tokio::test]
async fn webdav_large_file_streams_and_range_reads() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("drive");
    let base = spawn_server(data.clone()).await;
    let http = reqwest::Client::new();

    // ~10.5 MiB: spans 3 chunks (4 MiB + 4 MiB + partial), exercising the chunked path.
    let n = 11_000_000usize;
    let body: Vec<u8> = (0..n).map(|i| (i % 251) as u8).collect();

    let r = http.put(format!("{base}/big.bin")).body(body.clone()).send().await.unwrap();
    assert!(r.status().is_success(), "PUT big -> {}", r.status());

    // full GET is byte-exact
    let r = http.get(format!("{base}/big.bin")).send().await.unwrap();
    assert!(r.status().is_success(), "GET big -> {}", r.status());
    let got = r.bytes().await.unwrap();
    assert_eq!(got.len(), n, "size mismatch");
    assert!(got.as_ref() == body.as_slice(), "big body mismatch");

    // range read across a chunk boundary (bytes 4_194_200..4_194_400)
    let (a, b) = (4_194_200usize, 4_194_399usize);
    let r = http
        .get(format!("{base}/big.bin"))
        .header("Range", format!("bytes={a}-{b}"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 206, "range GET -> {}", r.status());
    let part = r.bytes().await.unwrap();
    assert_eq!(part.as_ref(), &body[a..=b], "range bytes mismatch");
}
