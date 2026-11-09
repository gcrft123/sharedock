//! A ready-to-run hyper WebDAV server for any [`Drive`], shared by the headless
//! runner (`apps/webdav`) and the desktop app (which mounts it in Finder).

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use dav_server::{fakels::FakeLs, DavHandler};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::{Drive, WebdavFs};

/// Bind a WebDAV server for `drive` on `addr` (use port 0 for an ephemeral port),
/// spawn its accept loop as a background task, and return the actually-bound
/// address plus the loop's `JoinHandle` (abort it to stop accepting connections).
/// When `log_requests` is set, each request is logged to stderr.
pub async fn spawn_server(
    drive: Arc<dyn Drive>,
    addr: SocketAddr,
    log_requests: bool,
) -> Result<(SocketAddr, JoinHandle<()>)> {
    let dav = DavHandler::builder()
        .filesystem(WebdavFs::new(drive))
        .locksystem(FakeLs::new())
        .build_handler();

    let listener = TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;

    let handle = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let dav = dav.clone();
            let io = TokioIo::new(stream);
            tokio::spawn(async move {
                let svc = service_fn(move |req| {
                    let dav = dav.clone();
                    async move {
                        if log_requests {
                            eprintln!("→ {} {}", req.method(), req.uri().path());
                        }
                        let resp = dav.handle(req).await;
                        Ok::<_, Infallible>(resp)
                    }
                });
                let _ = http1::Builder::new().serve_connection(io, svc).await;
            });
        }
    });

    Ok((bound, handle))
}
