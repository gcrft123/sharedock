//! pc-relay — local development relay (the stand-in for the Cloudflare Durable
//! Object). Forwards opaque AEAD frames between a host and its clients by role;
//! it never decrypts payloads. Production uses the DO in `services/control-plane`.

use anyhow::Result;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let addr = std::env::var("PC_RELAY_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let listener = TcpListener::bind(&addr).await?;
    println!("pc-relay listening on ws://{addr}/signal?account=<id>&role=host|client");
    core_net::relay::run_server(listener).await
}
