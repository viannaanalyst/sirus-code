//! System memory pressure.
//!
//! WebKit already trims its own caches when macOS reports memory pressure. The
//! renderer's caches (loaded transcripts beyond the open ones, parsed text) are
//! app data it can reload, so the app forwards the notification and the renderer
//! drops them.
//!
//! Freed native memory: the macOS allocator keeps freed large blocks in its large
//! cache, and `malloc_zone_pressure_relief` returned nothing for them when tried
//! (macOS 27). The bundle sets `MallocLargeCache=0` through `LSEnvironment` in
//! `Info.plist` instead (see docs/PERFORMANCE.md).

use tauri::AppHandle;

/// The renderer drops what it can reload (cached transcripts, parse caches).
pub const PRESSURE_EVENT: &str = "memory-pressure";

/// Watches the system's memory-pressure notifications for the app's lifetime.
#[cfg(target_os = "macos")]
pub fn watch_pressure(app: &AppHandle) {
    use tauri::Emitter;
    let app = app.clone();
    let installed = on_pressure(move || {
        tracing::info!("system memory pressure: asking the renderer to drop caches");
        let _ = app.emit(PRESSURE_EVENT, ());
    });
    if !installed {
        tracing::warn!("cannot watch memory pressure");
    }
}

/// Runs `handler` on a utility queue on every warning or critical pressure
/// notification. The dispatch source is never cancelled.
#[cfg(target_os = "macos")]
fn on_pressure(handler: impl Fn() + 'static) -> bool {
    use std::ffi::c_void;

    #[repr(C)]
    struct Opaque {
        _private: [u8; 0],
    }
    extern "C" {
        static _dispatch_source_type_memorypressure: Opaque;
        fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut c_void;
        fn dispatch_source_create(
            kind: *const Opaque,
            handle: usize,
            mask: usize,
            queue: *mut c_void,
        ) -> *mut c_void;
        fn dispatch_source_set_event_handler(
            source: *mut c_void,
            handler: &block2::Block<dyn Fn()>,
        );
        fn dispatch_resume(object: *mut c_void);
    }
    const WARN: usize = 0x02;
    const CRITICAL: usize = 0x04;
    const QOS_CLASS_UTILITY: isize = 0x11;

    let block = block2::RcBlock::new(handler);
    unsafe {
        let queue = dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
        let source = dispatch_source_create(
            &_dispatch_source_type_memorypressure,
            0,
            WARN | CRITICAL,
            queue,
        );
        if source.is_null() {
            return false;
        }
        // The source copies the block.
        dispatch_source_set_event_handler(source, &block);
        dispatch_resume(source);
    }
    true
}

#[cfg(not(target_os = "macos"))]
pub fn watch_pressure(_app: &AppHandle) {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn the_pressure_source_installs() {
        assert!(super::on_pressure(|| {}));
    }
}
