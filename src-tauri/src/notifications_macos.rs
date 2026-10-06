//! AppKit sound previews and native UserNotifications. No renderer-selected
//! identifiers, messages, URLs or audio files enter this module.
use super::{Notice, Permission, Sound};
use crate::{
    commands::AppState,
    error::{Error, Result},
};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DeclaredClass};
use objc2_app_kit::{NSSound, NSWorkspace};
use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSetting, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use std::{
    cell::RefCell,
    ptr::NonNull,
    sync::{mpsc, Arc},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

fn error(message: &str) -> Error {
    Error::new("notification", message)
}
fn supported() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}
fn permission_of(settings: &UNNotificationSettings) -> Permission {
    match settings.authorizationStatus() {
        UNAuthorizationStatus::NotDetermined => Permission::Prompt,
        UNAuthorizationStatus::Denied => Permission::Denied,
        _ if settings.alertSetting() == UNNotificationSetting::Disabled
            || settings.alertStyle() == UNAlertStyle::None =>
        {
            Permission::Denied
        }
        _ => Permission::Granted,
    }
}
async fn wait<T: Send + 'static>(rx: mpsc::Receiver<T>, timeout: Duration) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(timeout))
        .await
        .map_err(|_| error("Notification service unavailable."))?
        .map_err(|_| error("Notification service timed out."))
}
pub(super) async fn permission() -> Result<Permission> {
    if !supported() {
        return Ok(Permission::Unsupported);
    }
    let (tx, rx) = mpsc::channel();
    {
        let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            let _ = tx.send(permission_of(unsafe { settings.as_ref() }));
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&handler);
    }
    wait(rx, Duration::from_secs(5)).await
}
pub(super) async fn request() {
    if !supported() {
        return;
    }
    let (tx, rx) = mpsc::channel();
    {
        let handler = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = tx.send(());
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &handler,
            );
    }
    let _ = wait(rx, Duration::from_secs(300)).await;
}
pub(super) async fn show(app: &AppHandle, notice: &Notice) -> Result<()> {
    if permission().await? != Permission::Granted {
        return Err(error(
            "Allow notifications in System Settings to receive system alerts.",
        ));
    }
    let (tx, rx) = mpsc::channel();
    let app = app.clone();
    let dispatcher = app.clone();
    let notice = notice.clone();
    dispatcher
        .run_on_main_thread(move || {
            let skipped = tx.clone();
            if !super::deliver_if_current(&app, &notice, || {
                let content = UNMutableNotificationContent::new();
                content.setTitle(&NSString::from_str(&notice.title));
                content.setBody(&NSString::from_str(&notice.body));
                let identifier = if notice.session_id.is_empty() {
                    format!("sirus.test:{}", uuid::Uuid::new_v4())
                } else {
                    format!(
                        "sirus.session:{}/{}",
                        notice.session_id,
                        uuid::Uuid::new_v4()
                    )
                };
                let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                    &NSString::from_str(&identifier),
                    &content,
                    None,
                );
                let handler = RcBlock::new(move |failure: *mut NSError| {
                    let _ = tx.send(failure.is_null());
                });
                let center = UNUserNotificationCenter::currentNotificationCenter();
                RECENT.with(|recent| {
                    let mut recent = recent.borrow_mut();
                    if recent.len() == 64 {
                        if let Some(old) = recent.pop_front() {
                            let ids = objc2_foundation::NSArray::from_retained_slice(&[
                                NSString::from_str(&old),
                            ]);
                            center.removeDeliveredNotificationsWithIdentifiers(&ids);
                        }
                    }
                    recent.push_back(identifier);
                });
                // Silent OS banner; the selected AppKit sound is independent.
                center.addNotificationRequest_withCompletionHandler(&request, Some(&handler));
            }) {
                let _ = skipped.send(true);
            }
        })
        .map_err(|_| error("Notification service unavailable."))?;
    if wait(rx, Duration::from_secs(5)).await? {
        Ok(())
    } else {
        Err(error("The system could not display the notification."))
    }
}

thread_local! {
    static RECENT: RefCell<std::collections::VecDeque<String>> = const { RefCell::new(std::collections::VecDeque::new()) };
    static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) };
    static SOUND: RefCell<Option<Retained<NSSound>>> = const { RefCell::new(None) };
}
pub(super) fn play(choice: Sound) -> Result<()> {
    let name = match choice {
        Sound::Glass => "Glass",
        Sound::Ping => "Ping",
        Sound::Pop => "Pop",
        Sound::Submarine => "Submarine",
        Sound::Tink => "Tink",
        Sound::Hero => "Hero",
    };
    let sound = NSSound::soundNamed(&NSString::from_str(name))
        .ok_or_else(|| error("This sound is unavailable on this host."))?;
    SOUND.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(previous) = slot.take() {
            previous.stop();
        }
        if !sound.play() {
            return Err(error("The selected sound could not be played."));
        }
        *slot = Some(sound);
        Ok(())
    })
}
pub(super) fn open_settings() {
    // Fixed Sirus Code destination only; not a renderer-selected URL or app.
    if let Some(url) = objc2_foundation::NSURL::URLWithString(&NSString::from_str(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.siruscode.app",
    )) {
        NSWorkspace::sharedWorkspace().openURL(&url);
    }
}
struct DelegateIvars {
    app: AppHandle,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[name = "SirusNotificationDelegate"]
    #[ivars = DelegateIvars]
    struct NotificationDelegate;
    unsafe impl NSObjectProtocol for NotificationDelegate {}
    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler
                .call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List,));
        }
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn clicked(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            handler: &block2::DynBlock<dyn Fn()>,
        ) {
            if response.actionIdentifier().to_string()
                != unsafe { UNNotificationDefaultActionIdentifier }.to_string()
            {
                handler.call(());
                return;
            }
            let identifier = response.notification().request().identifier().to_string();
            let id = session_from_identifier(&identifier).map(str::to_owned);
            let app = self.ivars().app.clone();
            let dispatcher = app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                let state = app.state::<Arc<AppState>>();
                if state.ensure_running().is_err() {
                    return;
                }
                if let Some(id) = &id {
                    let data = state.data.lock();
                    if !data.sessions.iter().any(|session| {
                        session.id == *id
                            && data
                                .projects
                                .iter()
                                .any(|project| project.id == session.project_id)
                    }) {
                        return;
                    }
                    drop(data);
                    let _ = app.emit("notification-open", id);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            handler.call(());
        }
    }
);
fn session_from_identifier(identifier: &str) -> Option<&str> {
    let id = identifier
        .strip_prefix("sirus.session:")?
        .split('/')
        .next()?;
    uuid::Uuid::parse_str(id).ok()?;
    Some(id)
}
pub(super) fn install(app: &AppHandle) {
    if !supported() {
        return;
    }
    let delegate = NotificationDelegate::alloc().set_ivars(DelegateIvars { app: app.clone() });
    let delegate: Retained<NotificationDelegate> = unsafe { msg_send![super(delegate), init] };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn click_identifiers_only_resolve_native_session_uuids() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            session_from_identifier(&format!("sirus.session:{id}/notification")),
            Some(id.as_str())
        );
        assert_eq!(session_from_identifier("sirus.test:123"), None);
        assert_eq!(session_from_identifier("sirus.session:../../file"), None);
    }
    #[test]
    fn delegate_protocol_methods_are_registered() {
        use objc2::{sel, ClassType};
        assert!(NotificationDelegate::class().responds_to(
            sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:)
        ));
        assert!(NotificationDelegate::class().responds_to(
            sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:)
        ));
    }
}
