//! One explicit OS-selected window becomes a bounded private image attachment.
//! No renderer-selected window/PID, screen stream, app enumeration or control.
use crate::error::{Error, Result};

#[cfg(any(target_os = "macos", test))]
type CaptureResult = Result<Option<Vec<u8>>>;
#[cfg(any(target_os = "macos", test))]
struct Completion {
    sender: parking_lot::Mutex<Option<tokio::sync::oneshot::Sender<CaptureResult>>>,
    selected: std::sync::atomic::AtomicBool,
}
#[cfg(any(target_os = "macos", test))]
impl Completion {
    fn begin_capture(&self) -> bool {
        self.sender.lock().is_some()
            && !self
                .selected
                .swap(true, std::sync::atomic::Ordering::AcqRel)
    }
    fn finish(&self, result: Result<Option<Vec<u8>>>) -> bool {
        if let Some(sender) = self.sender.lock().take() {
            let _ = sender.send(result);
            true
        } else {
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub async fn pick(_app: &tauri::AppHandle) -> Result<Option<Vec<u8>>> {
    Err(Error::new(
        "unsupported",
        "Window attachments are available on macOS only.",
    ))
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::RcBlock;
    use objc2::{
        define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
    };
    use objc2_core_graphics::CGImage;
    use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSProcessInfo, NSString};
    use objc2_screen_capture_kit::{
        SCContentFilter, SCContentSharingPicker, SCContentSharingPickerConfiguration,
        SCContentSharingPickerMode, SCContentSharingPickerObserver, SCScreenshotManager,
        SCShareableContentStyle, SCStream, SCStreamConfiguration,
    };
    use std::{cell::RefCell, sync::Arc, time::Duration};

    struct Pending {
        completion: Completion,
        id: String,
        app: tauri::AppHandle,
    }
    impl Pending {
        fn finish(&self, result: Result<Option<Vec<u8>>>) {
            if self.completion.finish(result) {
                let id = self.id.clone();
                let _ = self.app.run_on_main_thread(move || clear(&id));
            }
        }
    }
    struct Ivars {
        pending: Arc<Pending>,
    }
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "SirusWindowAttachmentPicker"]
        #[ivars = Ivars]
        struct Observer;
        unsafe impl NSObjectProtocol for Observer {}
        unsafe impl SCContentSharingPickerObserver for Observer {
            #[unsafe(method(contentSharingPicker:didCancelForStream:))]
            fn cancel(&self, _picker: &SCContentSharingPicker, _stream: Option<&SCStream>) {
                let pending = self.ivars().pending.clone();
                pending.finish(Ok(None));
            }
            #[unsafe(method(contentSharingPickerStartDidFailWithError:))]
            fn failed(&self, _error: &NSError) {
                let pending = self.ivars().pending.clone();
                pending.finish(Err(Error::new(
                    "attachment",
                    "The native window picker could not open.",
                )));
            }
            #[unsafe(method(contentSharingPicker:didUpdateWithFilter:forStream:))]
            fn selected(
                &self,
                _picker: &SCContentSharingPicker,
                filter: &SCContentFilter,
                _stream: Option<&SCStream>,
            ) {
                let pending = self.ivars().pending.clone();
                if !pending.completion.begin_capture() {
                    return;
                }
                let rect = unsafe { filter.contentRect() };
                if !valid_dimensions(rect.size.width, rect.size.height) {
                    pending.finish(Err(Error::new(
                        "attachment",
                        "Invalid selected window dimensions.",
                    )));
                    return;
                }
                let scale = (1600.0 / rect.size.width.max(rect.size.height)).min(2.0);
                let config = unsafe { SCStreamConfiguration::new() };
                unsafe {
                    config.setWidth((rect.size.width * scale).round().max(1.0) as usize);
                    config.setHeight((rect.size.height * scale).round().max(1.0) as usize);
                    config.setShowsCursor(false);
                    config.setIgnoreShadowsSingleWindow(true);
                }
                let pending = pending.clone();
                let done = RcBlock::new(move |image: *mut CGImage, _error: *mut NSError| {
                    let result = unsafe { image.as_ref() }
                        .filter(|image| {
                            let width = CGImage::width(Some(image));
                            let height = CGImage::height(Some(image));
                            width > 0 && height > 0 && width <= 1600 && height <= 1600
                        })
                        .and_then(crate::computer::encode)
                        .map(|image| image.jpeg)
                        .filter(|bytes| bytes.len() <= crate::attachments::MAX_FILE_BYTES)
                        .map(|bytes| Ok(Some(bytes)))
                        .unwrap_or_else(|| {
                            Err(Error::new(
                                "attachment",
                                "The selected window could not be captured.",
                            ))
                        });
                    pending.finish(result);
                });
                unsafe {
                    SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                        filter,
                        &config,
                        Some(&done),
                    );
                }
            }
        }
    );
    thread_local! { static OBSERVER: RefCell<Option<Retained<Observer>>> = const { RefCell::new(None) }; }
    fn clear(id: &str) {
        OBSERVER.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot
                .as_ref()
                .is_some_and(|observer| observer.ivars().pending.id == id)
            {
                if let Some(observer) = slot.take() {
                    unsafe {
                        let picker = SCContentSharingPicker::sharedPicker();
                        picker.removeObserver(ProtocolObject::from_ref(&*observer));
                        picker.setActive(false);
                    }
                }
            }
        });
    }
    pub async fn pick(app: &tauri::AppHandle) -> Result<Option<Vec<u8>>> {
        if NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            < 14
        {
            return Err(Error::new(
                "unsupported",
                "Window attachments require macOS 14 or later.",
            ));
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let pending = Arc::new(Pending {
            completion: Completion {
                sender: parking_lot::Mutex::new(Some(sender)),
                selected: std::sync::atomic::AtomicBool::new(false),
            },
            id: uuid::Uuid::new_v4().to_string(),
            app: app.clone(),
        });
        let start = pending.clone();
        app.run_on_main_thread(move || {
            let previous = OBSERVER.with(|slot| {
                slot.borrow()
                    .as_ref()
                    .map(|observer| observer.ivars().pending.id.clone())
            });
            if let Some(id) = previous {
                clear(&id);
            }
            let observer = Observer::alloc().set_ivars(Ivars { pending: start });
            let observer: Retained<Observer> = unsafe { msg_send![super(observer), init] };
            unsafe {
                let picker = SCContentSharingPicker::sharedPicker();
                let config = SCContentSharingPickerConfiguration::new();
                config.setAllowedPickerModes(SCContentSharingPickerMode::SingleWindow);
                config.setAllowsChangingSelectedContent(false);
                let excluded =
                    NSArray::from_retained_slice(&[NSString::from_str("com.siruscode.app")]);
                config.setExcludedBundleIDs(&excluded);
                picker.setDefaultConfiguration(&config);
                picker.addObserver(ProtocolObject::from_ref(&*observer));
                OBSERVER.with(|slot| *slot.borrow_mut() = Some(observer));
                picker.setActive(true);
                picker.presentPickerUsingContentStyle(SCShareableContentStyle::Window);
            }
        })
        .map_err(|_| Error::new("attachment", "Could not open native window picker."))?;
        match tokio::time::timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(result)) => result,
            _ => {
                let error = Error::new("attachment", "Window selection timed out or closed.");
                pending.finish(Err(Error::new(
                    "attachment",
                    "Window selection timed out or closed.",
                )));
                Err(error)
            }
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn valid_dimensions(width: f64, height: f64) -> bool {
    width.is_finite()
        && height.is_finite()
        && width > 0.0
        && height > 0.0
        && width <= 32768.0
        && height <= 32768.0
}
#[cfg(target_os = "macos")]
pub use platform::pick;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_sizes_must_be_finite_positive_and_bounded() {
        assert!(valid_dimensions(1920.0, 1080.0));
        assert!(!valid_dimensions(f64::INFINITY, 2.0));
        assert!(!valid_dimensions(2.0, f64::NAN));
        assert!(!valid_dimensions(-1.0, 2.0));
        assert!(!valid_dimensions(40000.0, 2.0));
    }

    #[test]
    fn cancel_or_timeout_rejects_late_capture_and_completes_once() {
        for result in [Ok(None), Err(Error::new("attachment", "Timed out"))] {
            let (sender, mut receiver) = tokio::sync::oneshot::channel();
            let completion = Completion {
                sender: parking_lot::Mutex::new(Some(sender)),
                selected: std::sync::atomic::AtomicBool::new(false),
            };
            let canceled = result.is_ok();
            assert!(completion.finish(result));
            assert!(!completion.begin_capture());
            assert!(!completion.finish(Ok(Some(vec![1, 2]))));
            assert_eq!(receiver.try_recv().unwrap().is_ok(), canceled);
        }
    }

    #[test]
    fn selected_window_is_captured_at_most_once() {
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        let completion = Completion {
            sender: parking_lot::Mutex::new(Some(sender)),
            selected: std::sync::atomic::AtomicBool::new(false),
        };
        assert!(completion.begin_capture());
        assert!(!completion.begin_capture());
        assert!(completion.finish(Ok(Some(vec![1]))));
        assert!(!completion.finish(Ok(None)));
        assert_eq!(receiver.try_recv().unwrap().unwrap(), Some(vec![1]));
    }
}
