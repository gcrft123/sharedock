//! Add the mounted drive to the Finder sidebar's **Favorites** via LSSharedFileList.
//!
//! There is no supported way to auto-populate the *Locations* section without a
//! NetFS credentials prompt on every mount (see `mount.rs`), so we pin a persistent
//! Favorites entry instead — one click to the drive, and it survives unmount.
//!
//! `LSSharedFileList` has been deprecated since 10.11 but is still functional; this
//! is entirely best-effort — any failure is silent and never blocks a mount.

use std::path::Path;

#[cfg(target_os = "macos")]
pub fn add_to_favorites(path: &Path) {
    use core_foundation::base::{CFRelease, TCFType};
    use core_foundation::string::CFString;
    use core_foundation::url::CFURL;
    use std::os::raw::c_void;
    use std::ptr;

    #[allow(non_upper_case_globals)]
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        static kLSSharedFileListFavoriteItems: *const c_void; // CFStringRef
        static kLSSharedFileListItemLast: *mut c_void; // sentinel: append
        fn LSSharedFileListCreate(
            alloc: *const c_void,
            list_type: *const c_void,
            options: *const c_void,
        ) -> *mut c_void;
        fn LSSharedFileListInsertItemURL(
            list: *mut c_void,
            after: *mut c_void,
            display_name: *const c_void,
            icon: *const c_void,
            url: *const c_void,
            props: *const c_void,
            array: *const c_void,
        ) -> *mut c_void;
    }

    let Some(url) = CFURL::from_path(path, true) else {
        return;
    };
    let name = CFString::new("Sharedock");

    unsafe {
        let list =
            LSSharedFileListCreate(ptr::null(), kLSSharedFileListFavoriteItems, ptr::null());
        if list.is_null() {
            return;
        }
        let _ = LSSharedFileListInsertItemURL(
            list,
            kLSSharedFileListItemLast,
            name.as_concrete_TypeRef() as *const c_void,
            ptr::null(),
            url.as_concrete_TypeRef() as *const c_void,
            ptr::null(),
            ptr::null(),
        );
        CFRelease(list as *const c_void);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn add_to_favorites(_path: &Path) {}
