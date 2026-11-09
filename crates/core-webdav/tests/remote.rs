//! W2 e2e: a WebDAV mount backed by a REMOTE host over the relay. Exercises the
//! full path WebDAV -> RemoteDrive -> relay -> host -> store, including the chunked
//! RPC for a multi-chunk (streamed) file — the first Rust client to drive it — and
//! the new remote MOVE (Rename RPC).

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use core_crypto::{AccountRootKey, DeviceKeypair};
use core_webdav::{Drive, RemoteDrive, WebdavFs};
use dav_server::{fakels::FakeLs, DavHandler};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

fn method(m: &str) -> reqwest::Method {
    reqwest::Method::from_bytes(m.as_bytes()).unwrap()
}

async fn serve_webdav(drive: Arc<dyn Drive>) -> String {
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn webdav_over_relay_to_remote_host() {
    // 1. relay (dev stand-in for the Cloudflare DO)
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let relay_addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = core_net::relay::run_server(listener).await;
    });
    let relay = format!("ws://{relay_addr}");
    let account = "acct-webdav-w2".to_string();

    // 2. host + pairing (ARK is client-side; the host only stores ciphertext)
    let mut host = host_agent::HostAgent::init(host_agent::HostConfig {
        data_dir: std::env::temp_dir().join(format!("pc-w2-host-{}", std::process::id())),
        quota_bytes: 100 * 1024 * 1024,
    })
    .unwrap();
    let client_kp = DeviceKeypair::generate();
    host.authorize_client(client_kp.id);
    let host_pub = host.agreement_public();
    let ark = AccountRootKey::generate();

    // 3. host serve loop on its own thread (single-thread rt tolerates !Send rusqlite)
    {
        let relay = relay.clone();
        let account = account.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            rt.block_on(async move {
                let _ = core_net::relay::serve(
                    &relay,
                    &account,
                    None, // host room: the legacy account-only room
                    None, // relay token
                    host.agreement_public(),
                    |b| host.open_sealed(b),
                    |id| host.is_authorized(id),
                    |req| host.handle(req),
                    tokio::sync::broadcast::channel::<()>(1).1,
                )
                .await;
            });
        });
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    // 4. remote-backed WebDAV
    let client =
        client_core::RemoteDrive::connect(&relay, &account, &client_kp, &host_pub, None, None)
            .await
            .unwrap();
    let drive: Arc<dyn Drive> = Arc::new(RemoteDrive::new(client, ark));
    let base = serve_webdav(drive).await;
    let http = reqwest::Client::new();

    // MKCOL
    let r = http.request(method("MKCOL"), format!("{base}/Docs")).send().await.unwrap();
    assert!(r.status().is_success(), "MKCOL -> {}", r.status());

    // PUT a multi-chunk file (9 MB -> 3 chunks over the chunked RPC)
    let n = 9_000_000usize;
    let body: Vec<u8> = (0..n).map(|i| (i % 251) as u8).collect();
    let r = http.put(format!("{base}/Docs/big.bin")).body(body.clone()).send().await.unwrap();
    assert!(r.status().is_success(), "PUT -> {}", r.status());

    // GET back byte-exact (streamed read over the relay)
    let r = http.get(format!("{base}/Docs/big.bin")).send().await.unwrap();
    assert!(r.status().is_success(), "GET -> {}", r.status());
    let got = r.bytes().await.unwrap();
    assert_eq!(got.len(), n, "remote size mismatch");
    assert!(got.as_ref() == body.as_slice(), "remote body mismatch");

    // PROPFIND lists it
    let r = http
        .request(method("PROPFIND"), format!("{base}/Docs"))
        .header("Depth", "1")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 207, "PROPFIND -> {}", r.status());
    assert!(r.text().await.unwrap().contains("big.bin"), "listing missing file");

    // MOVE (remote rename via the new Rename RPC)
    let r = http
        .request(method("MOVE"), format!("{base}/Docs/big.bin"))
        .header("Destination", format!("{base}/Docs/moved.bin"))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success(), "MOVE -> {}", r.status());
    let r = http.get(format!("{base}/Docs/big.bin")).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 404, "old path still present after MOVE");
    let r = http.get(format!("{base}/Docs/moved.bin")).send().await.unwrap();
    assert_eq!(r.bytes().await.unwrap().len(), n, "moved file wrong size");

    // DELETE
    let r = http.request(method("DELETE"), format!("{base}/Docs/moved.bin")).send().await.unwrap();
    assert!(r.status().is_success(), "DELETE -> {}", r.status());
    let r = http.get(format!("{base}/Docs/moved.bin")).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 404, "deleted file still readable");
}
