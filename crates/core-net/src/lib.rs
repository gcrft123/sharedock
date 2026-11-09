//! Overlay-transport + relay layer.
//!
//! Phase 1 ships the **relay** data path end-to-end: an AEAD session established
//! over the account rendezvous (the `session` module), carried as opaque binary
//! frames the relay blindly forwards (the `relay` module). The direct Iroh
//! hole-punched path is the Phase 2 fast path and slots in behind the same
//! `Session`/RPC seam.

#[cfg(feature = "iroh")]
pub mod iroh;
pub mod relay;
pub mod session;

use core_crypto::DeviceId;
use core_proto::LinkPath;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RelayHint {
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EndpointInfo {
    pub node: DeviceId,
    pub relay: Option<RelayHint>,
}

#[derive(Clone, Copy, Debug)]
pub struct ConnectionInfo {
    pub path: LinkPath,
    pub latency_ms: u32,
}

/// A live connection to a host. Phase 2: an Iroh QUIC connection.
pub trait Transport {
    fn info(&self) -> ConnectionInfo;
}

pub struct OfflineTransport;
impl Transport for OfflineTransport {
    fn info(&self) -> ConnectionInfo {
        ConnectionInfo { path: LinkPath::Offline, latency_ms: 0 }
    }
}
