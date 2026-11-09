//! pc-cli — a minimal client that drives a host over the relay and self-tests the
//! full encrypted round-trip. This is the runnable, real-process counterpart to
//! the in-process `e2e` integration test.
//!
//! Config via env:
//!   PC_RELAY_URL   ws://host:port         (required)
//!   PC_ACCOUNT     rendezvous account id  (default "default")
//!   PC_HOST_PUB    host agreement pubkey, hex (printed by pc-daemon; required)

use anyhow::{anyhow, Result};
use core_crypto::{AccountRootKey, AgreementPublic, DeviceKeypair};

#[tokio::main]
async fn main() -> Result<()> {
    let relay = std::env::var("PC_RELAY_URL").map_err(|_| anyhow!("set PC_RELAY_URL"))?;
    let account = std::env::var("PC_ACCOUNT").unwrap_or_else(|_| "default".to_string());
    let host_pub_hex = std::env::var("PC_HOST_PUB").map_err(|_| anyhow!("set PC_HOST_PUB"))?;

    let bytes = core_crypto::from_hex(&host_pub_hex).ok_or_else(|| anyhow!("bad PC_HOST_PUB hex"))?;
    let arr: [u8; 32] = bytes.as_slice().try_into().map_err(|_| anyhow!("PC_HOST_PUB must be 32 bytes"))?;
    let host_pub = AgreementPublic::from_bytes(arr);

    // Deterministic identity when PC_CLIENT_KEY (hex, 64 bytes) is set — lets a
    // caller pre-register this client's id in the host allowlist; else ephemeral.
    let client = match std::env::var("PC_CLIENT_KEY").ok().and_then(|h| core_crypto::from_hex(&h)) {
        Some(b) if b.len() == 64 => {
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&b);
            DeviceKeypair::from_bytes(&arr)
        }
        _ => DeviceKeypair::generate(),
    };
    // Shared account key: PC_ARK (hex, 32 bytes) lets this client see + decrypt files
    // written by other clients on the account; otherwise a fresh (self-test) key.
    let ark = match std::env::var("PC_ARK").ok().and_then(|h| core_crypto::from_hex(&h)) {
        Some(b) if b.len() == 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&b);
            AccountRootKey::from_bytes(a)
        }
        _ => AccountRootKey::generate(),
    };
    println!("pc-cli · device {} · account {account}", client.id.short());
    println!("  client id:   {}", core_crypto::to_hex(client.id.as_bytes()));
    println!(
        "  account key: {}  (set PC_ARK to share files with other clients)",
        core_crypto::to_hex(&ark.to_bytes())
    );

    let token = std::env::var("PC_RELAY_TOKEN").ok();
    let mut drive =
        client_core::RemoteDrive::connect(&relay, &account, &client, &host_pub, None, token.as_deref())
            .await?;

    // encrypted round-trip self-test
    drive.mkdir("/", "cli").await?;
    let data = b"hello from pc-cli, end to end over the relay".to_vec();
    let payload = client_core::encrypt_file(&ark, &data);
    drive.put("/cli", "hello.txt", payload).await?;

    let names: Vec<String> = drive.list("/cli").await?.into_iter().map(|e| e.name).collect();
    println!("  listing /cli: {names:?}");

    let got = drive.read("/cli/hello.txt").await?;
    let decrypted = client_core::decrypt_file(&ark, &got)?;
    if decrypted != data {
        return Err(anyhow!("round-trip MISMATCH"));
    }

    let q = drive.quota().await?;
    println!(
        "  OK · round-trip verified · quota {} used / {} total bytes, {} files",
        q.used_bytes, q.quota_bytes, q.file_count
    );

    drive.close().await?;
    Ok(())
}
