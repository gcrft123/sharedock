//! Group C part 2 — multi-client relay. TWO clients talk to ONE host through the
//! relay at the same time. Proves the per-connection multiplexing keeps their
//! sessions isolated: with the old broadcast relay, the host's reply to one client
//! was fanned to BOTH, desyncing the other (wrong bytes / decrypt failure). Here the
//! two clients run concurrently and each must get exactly its own data back.

use std::time::Duration;
use tokio::net::TcpListener;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_clients_do_not_cross_talk() -> anyhow::Result<()> {
    // relay (dev stand-in for the account Durable Object)
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = core_net::relay::run_server(listener).await;
    });
    let base = format!("ws://{addr}");
    let account = "acct-mc".to_string();

    // host + two authorized client devices, one shared account key
    let mut host = host_agent::HostAgent::init(host_agent::HostConfig {
        data_dir: std::env::temp_dir().join(format!("pc-mc-{}", std::process::id())),
        quota_bytes: 10_000_000,
    })?;
    let dev_a = core_crypto::DeviceKeypair::generate();
    let dev_b = core_crypto::DeviceKeypair::generate();
    host.authorize_client(dev_a.id);
    host.authorize_client(dev_b.id);
    let host_pub = host.agreement_public();
    let ark = core_crypto::AccountRootKey::generate();

    // host serve loop on its own thread (single-thread runtime tolerates rusqlite)
    {
        let base = base.clone();
        let account = account.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            rt.block_on(async move {
                let _ = core_net::relay::serve(
                    &base,
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

    // The two sequences run CONCURRENTLY so their requests interleave at the relay +
    // host. A read returning the wrong bytes (or a session-decrypt failure) would mean
    // the sessions cross-talked.
    let a = client_seq(&base, &account, &dev_a, &host_pub, &ark, 'A');
    let b = client_seq(&base, &account, &dev_b, &host_pub, &ark, 'B');
    let (ra, rb) = tokio::join!(a, b);
    ra?;
    rb?;

    Ok(())
}

async fn client_seq(
    base: &str,
    account: &str,
    dev: &core_crypto::DeviceKeypair,
    host_pub: &core_crypto::AgreementPublic,
    ark: &core_crypto::AccountRootKey,
    tag: char,
) -> anyhow::Result<()> {
    let mut d = client_core::RemoteDrive::connect(base, account, dev, host_pub, None, None).await?;
    d.mkdir("/", &tag.to_string()).await?;
    for i in 0..15 {
        let pt = format!("{tag}{tag}{tag}-{i}").into_bytes();
        let name = format!("{tag}{i}.txt");
        d.put(&format!("/{tag}"), &name, client_core::encrypt_file(ark, &pt)).await?;
        // interleave a read right after the write to stress request/response pairing
        let got = d.read(&format!("/{tag}/{name}")).await?;
        assert_eq!(
            client_core::decrypt_file(ark, &got)?,
            pt,
            "client {tag} got the wrong bytes (session cross-talk)"
        );
    }
    let list = d.list(&format!("/{tag}")).await?;
    assert_eq!(list.len(), 15, "client {tag} listing wrong");
    d.close().await?;
    Ok(())
}
