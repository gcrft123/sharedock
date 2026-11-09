//! Small platform shims shared by the host, service and mount modules.

use std::ffi::OsStr;
use std::process::Command;

/// A `Command` that will not open a console window. A GUI app on Windows spawning `net`,
/// `schtasks`, `tasklist` or `icacls` otherwise flashes a black terminal at the user for each
/// call; everywhere else this is a plain `Command::new`.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}
