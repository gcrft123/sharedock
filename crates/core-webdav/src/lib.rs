//! WebDAV surface over the encrypted drive (P2).
//!
//! [`WebdavFs`] implements `dav_server::fs::DavFileSystem` over a [`Drive`] — a
//! streaming, plaintext-facing view of an encrypted store. The drive holds the
//! Account Root Key and does per-chunk encrypt/decrypt, so file bytes stream in
//! fixed 4 MiB chunks and a whole file never sits in memory.
//!
//!  - **W1 / W1.1**: [`LocalDrive`] — an in-process `core-fs` store (local mount).
//!  - **W2**: [`RemoteDrive`] — a host reached over the relay (remote mount).

mod drive;
mod file;
mod fs;
mod meta;
mod multi;
mod remote;
mod server;

pub use drive::{Drive, Entry, LocalDrive, Usage, CHUNK};
pub use fs::WebdavFs;
pub use multi::{HostId, Mode, MultiHostDrive, Reconnector, Strategy};
pub use remote::RemoteDrive;
pub use server::spawn_server;
