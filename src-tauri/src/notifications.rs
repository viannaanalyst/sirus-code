//! Native-owned session alerts. Renderer actions cannot supply message text,
//! session IDs, sound paths or lifecycle events.
use crate::{
    commands::AppState,
    error::{Error, Result},
    models::{MessageRole, PendingRequestKind, Session, SessionStatus},
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "macos")]
#[path = "notifications_macos.rs"]
mod platform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Sound {
    Glass,
    Ping,
    Pop,
    Submarine,
    Tink,
    Hero,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub toasts: bool,
    pub system: bool,
    pub sounds: bool,
    pub foreground: bool,
    pub permissions: bool,
    pub questions: bool,
    pub completion: bool,
    pub permission_sound: Sound,
    pub question_sound: Sound,
    pub completion_sound: Sound,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            toasts: true,
            system: true,
            sounds: true,
            foreground: false,
            permissions: true,
            questions: true,
            completion: true,
            permission_sound: Sound::Ping,
            question_sound: Sound::Pop,
            completion_sound: Sound::Glass,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Prompt,
    Granted,
    Denied,
    Unsupported,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Status {},
    Request {},
    Test {},
    Settings {},
    Preview { sound: Sound },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Permission,
    Question,
    Completion,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub created_at: i64,
    pub id: String,
    pub session_id: String,
    pub kind: Kind,
    pub title: String,
    pub body: String,
}

#[derive(Default)]
pub struct NotificationState {
    seen: Mutex<VecDeque<String>>,
    previewed: Mutex<Option<Instant>>,
    tested: Mutex<Option<Instant>>,
    requesting: std::sync::atomic::AtomicBool,
}
fn notification_error(message: &str) -> Error {
    Error::new("notification", message)
}
fn admit_time(slot: &Mutex<Option<Instant>>, interval: Duration) -> Result<()> {
    let mut slot = slot.lock();
    if slot.is_some_and(|previous| previous.elapsed() < interval) {
        return Err(notification_error("Please wait before testing again."));
    }
    *slot = Some(Instant::now());
    Ok(())
}
fn remember(seen: &mut VecDeque<String>, key: &str) -> bool {
    if seen.iter().any(|existing| existing == key) {
        return false;
    }
    if seen.len() == 256 {
        seen.pop_front();
    }
    seen.push_back(key.into());
    true
}
fn candidates(session: &Session) -> Vec<(String, Kind)> {
    if session.status == SessionStatus::Completed && session.last_error.is_none() {
        return session
            .messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::User)
            .map(|message| {
                vec![(
                    format!("{}:completed:{}", session.id, message.id),
                    Kind::Completion,
                )]
            })
            .unwrap_or_default();
    }
    if session.status != SessionStatus::Waiting {
        return vec![];
    }
    session
        .pending_requests
        .iter()
        .map(|request| {
            (
                format!(
                    "{}:{}:{}:{}",
                    session.id, request.generation, request.turn_id, request.request_id
                ),
                if matches!(request.kind, PendingRequestKind::UserInput { .. }) {
                    Kind::Question
                } else {
                    Kind::Permission
                },
            )
        })
        .collect()
}
fn choice(prefs: &Preferences, kind: Kind) -> (bool, Sound) {
    match kind {
        Kind::Permission => (prefs.permissions, prefs.permission_sound),
        Kind::Question => (prefs.questions, prefs.question_sound),
        Kind::Completion => (prefs.completion, prefs.completion_sound),
    }
}
fn copy(kind: Kind, portuguese: bool) -> &'static str {
    match (kind, portuguese) {
        (Kind::Permission, true) => "Permissão necessária",
        (Kind::Question, true) => "Resposta necessária",
        (Kind::Completion, true) => "Tarefa concluída",
        (Kind::Permission, false) => "Permission needed",
        (Kind::Question, false) => "Answer needed",
        (Kind::Completion, false) => "Task completed",
    }
}
fn bounded_label(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control())
        .take(96)
        .collect()
}

/// Called only at fresh native request admission and settled completion, never
/// on bootstrap, metadata edits or renderer snapshots.
/// A native-originated status alert that is not tied to a pending request
/// (CI auto-fix green/paused). It honours the person's channel preferences.
pub fn announce(app: &AppHandle, state: &Arc<AppState>, title: String, body: String) {
    let (prefs, foreground) = {
        let data = state.data.lock();
        let foreground = app
            .get_webview_window("main")
            .is_some_and(|window| window.is_focused().unwrap_or(true));
        (data.settings.notifications.clone(), foreground)
    };
    let notice = Notice {
        created_at: chrono::Utc::now().timestamp_millis(),
        id: uuid::Uuid::new_v4().to_string(),
        session_id: String::new(),
        kind: Kind::Completion,
        title: bounded_label(&title),
        body: bounded_label(&body),
    };
    if prefs.toasts {
        let _ = app.emit("notification-activity", &notice);
    }
    #[cfg(target_os = "macos")]
    if prefs.system && (!foreground || prefs.foreground) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = platform::show(&app, &notice).await {
                tracing::debug!(%error, "system status alert unavailable");
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = foreground;
}

pub fn publish(app: &AppHandle, state: &Arc<AppState>, snapshot: &Session) {
    let expected = candidates(snapshot);
    if expected.is_empty() {
        return;
    }
    let app = app.clone();
    let dispatcher = app.clone();
    let state = state.clone();
    let id = snapshot.id.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        let data = state.data.lock();
        if state.closing.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        let Some(session) = data.sessions.iter().find(|session| session.id == id) else {
            return;
        };
        let Some(project) = data
            .projects
            .iter()
            .find(|project| project.id == session.project_id)
        else {
            return;
        };
        let current = candidates(session);
        let prefs = data.settings.notifications.clone();
        let body = format!(
            "{} · {}",
            bounded_label(&project.name),
            bounded_label(&session.title)
        );
        let portuguese = data.settings.locale == "pt-BR";
        let foreground = app
            .get_webview_window("main")
            .is_some_and(|window| window.is_focused().unwrap_or(true));
        let eligible = !foreground || prefs.foreground;
        let notices: Vec<_> = expected
            .into_iter()
            .filter(|candidate| current.contains(candidate))
            .collect();
        drop(data);
        for (key, kind) in notices {
            // Consume even disabled events: enabling later cannot replay them.
            if !remember(&mut app.state::<NotificationState>().seen.lock(), &key) {
                continue;
            }
            let (enabled, sound) = choice(&prefs, kind);
            if !enabled {
                continue;
            }
            let notice = Notice {
                created_at: chrono::Utc::now().timestamp_millis(),
                id: key,
                session_id: id.clone(),
                kind,
                title: copy(kind, portuguese).into(),
                body: body.clone(),
            };
            if prefs.toasts {
                let _ = app.emit("notification-activity", &notice);
            }
            #[cfg(target_os = "macos")]
            {
                if prefs.sounds && eligible {
                    let _ = platform::play(sound);
                }
                if prefs.system && eligible {
                    let app = app.clone();
                    let notice = notice.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = platform::show(&app, &notice).await {
                            tracing::debug!(%error, "system activity alert unavailable");
                        }
                    });
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (eligible, sound);
        }
    });
}

pub fn install(app: &AppHandle) {
    app.manage(NotificationState::default());
    #[cfg(target_os = "macos")]
    platform::install(app);
}

/// Final admission happens on the main thread after the OS permission lookup.
/// Hold native ownership while submitting; a resolved request or removal cannot
/// race this gate. Explicit tests have no session and do not impersonate work.
#[cfg(target_os = "macos")]
pub(super) fn deliver_if_current(app: &AppHandle, notice: &Notice, deliver: impl FnOnce()) -> bool {
    let state = app.state::<Arc<AppState>>();
    let data = state.data.lock();
    if state.ensure_running().is_err() {
        return false;
    }
    let foreground = app
        .get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(true));
    if !current_notice(&data, notice, foreground) {
        return false;
    }
    deliver();
    true
}

#[cfg(any(target_os = "macos", test))]
fn current_notice(data: &crate::models::AppData, notice: &Notice, foreground: bool) -> bool {
    if notice.session_id.is_empty() {
        return true;
    }
    let Some(session) = data
        .sessions
        .iter()
        .find(|session| session.id == notice.session_id)
    else {
        return false;
    };
    let prefs = &data.settings.notifications;
    data.projects
        .iter()
        .any(|project| project.id == session.project_id)
        && candidates(session).contains(&(notice.id.clone(), notice.kind))
        && prefs.system
        && choice(prefs, notice.kind).0
        && (!foreground || prefs.foreground)
}

#[tauri::command]
pub async fn notification_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Permission> {
    state.ensure_running()?;
    match action {
        Action::Preview { sound } => {
            admit_time(
                &app.state::<NotificationState>().previewed,
                Duration::from_millis(300),
            )?;
            #[cfg(target_os = "macos")]
            {
                let (tx, rx) = tokio::sync::oneshot::channel();
                app.run_on_main_thread(move || {
                    let _ = tx.send(platform::play(sound));
                })
                .map_err(|_| notification_error("Sound preview unavailable."))?;
                rx.await
                    .map_err(|_| notification_error("Sound preview unavailable."))??;
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = sound;
                return Err(notification_error(
                    "Notification sounds are unavailable on this host.",
                ));
            }
        }
        Action::Request {} => {
            let notification_state = app.state::<NotificationState>();
            if notification_state
                .requesting
                .swap(true, std::sync::atomic::Ordering::AcqRel)
            {
                return Err(notification_error(
                    "Notification permission request is already open.",
                ));
            }
            #[cfg(target_os = "macos")]
            platform::request().await;
            notification_state
                .requesting
                .store(false, std::sync::atomic::Ordering::Release);
        }
        Action::Test {} => {
            admit_time(
                &app.state::<NotificationState>().tested,
                Duration::from_secs(3),
            )?;
            let settings = state.data.lock().settings.clone();
            let portuguese = settings.locale == "pt-BR";
            let notice = Notice {
                created_at: chrono::Utc::now().timestamp_millis(),
                id: uuid::Uuid::new_v4().to_string(),
                session_id: String::new(),
                kind: Kind::Completion,
                title: "Sirus Code".into(),
                body: if portuguese {
                    "Teste de notificação. Seus avisos de atividade aparecerão aqui."
                } else {
                    "Notification test. Your activity alerts will appear here."
                }
                .into(),
            };
            #[cfg(target_os = "macos")]
            {
                platform::show(&app, &notice).await?;
                if settings.notifications.sounds {
                    let sound = settings.notifications.completion_sound;
                    app.run_on_main_thread(move || {
                        let _ = platform::play(sound);
                    })
                    .map_err(|_| notification_error("Sound preview unavailable."))?;
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = notice;
                return Err(notification_error(
                    "System notifications are unavailable on this host.",
                ));
            }
        }
        Action::Status {} => {}
        Action::Settings {} => {
            #[cfg(target_os = "macos")]
            app.run_on_main_thread(platform::open_settings)
                .map_err(|_| notification_error("Notification service unavailable."))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        platform::permission().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Permission::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> Session {
        serde_json::from_value(serde_json::json!({
            "id": "session", "title": "Work", "projectId":"project", "agent":"codex", "status":"running",
            "createdAt":"2026-10-02T00:00:00Z", "lastActivityAt":"2026-10-02T00:00:00Z",
            "worktree":{"path":"/workspace", "branch":"main", "isolated":false}, "lastError":null,
            "messages":[{"id":"user1", "sessionId":"session", "role":"user", "content":"private prompt", "createdAt":"2026-10-02T00:00:00Z", "streaming":false}]
        })).unwrap()
    }
    #[test]
    fn only_successful_settlements_notify_and_each_user_turn_is_distinct() {
        let mut session = session();
        for status in [
            SessionStatus::Running,
            SessionStatus::Starting,
            SessionStatus::Stopped,
            SessionStatus::Failed,
            SessionStatus::Idle,
        ] {
            session.status = status;
            assert!(candidates(&session).is_empty());
        }
        session.status = SessionStatus::Completed;
        let first = candidates(&session);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].1, Kind::Completion);
        session.messages[0].id = "user2".into();
        assert_ne!(first, candidates(&session));
        session.last_error = Some("Failure".into());
        assert!(candidates(&session).is_empty());
    }
    #[test]
    fn pending_identity_includes_generation_and_classifies_real_questions() {
        let mut session = session();
        session.status = SessionStatus::Waiting;
        let mut request = crate::models::PendingRequest {
            request_id: "request".into(),
            generation: "generation1".into(),
            turn_id: "turn".into(),
            item_id: "item".into(),
            kind: PendingRequestKind::UserInput { questions: vec![] },
        };
        session.pending_requests.push(request.clone());
        let first = candidates(&session);
        assert_eq!(first[0].1, Kind::Question);
        request.generation = "generation2".into();
        request.kind = PendingRequestKind::Command {
            command: "private command".into(),
            cwd: None,
            reason: None,
        };
        session.pending_requests = vec![request];
        assert_ne!(first[0].0, candidates(&session)[0].0);
        assert_eq!(candidates(&session)[0].1, Kind::Permission);
        session.pending_requests.clear();
        assert!(candidates(&session).is_empty());
        assert!(!first[0].0.contains("private prompt"));
    }
    #[test]
    fn final_delivery_gate_rejects_resolved_removed_disabled_and_foreground_events() {
        let mut data = crate::models::AppData::default();
        data.projects.push(crate::models::Project {
            id: "project".into(),
            name: "Project".into(),
            path: "/workspace".into(),
            added_at: "time".into(),
            last_opened_at: "time".into(),
            look: Default::default(),
            scripts: Default::default(),
        });
        let mut session = session();
        session.status = SessionStatus::Completed;
        let (id, kind) = candidates(&session).remove(0);
        data.sessions.push(session);
        let notice = Notice {
            id,
            kind,
            session_id: "session".into(),
            title: "Task completed".into(),
            body: "Project · Work".into(),
            created_at: 0,
        };
        assert!(current_notice(&data, &notice, false));
        assert!(!current_notice(&data, &notice, true));
        data.settings.notifications.foreground = true;
        assert!(current_notice(&data, &notice, true));
        data.settings.notifications.system = false;
        assert!(!current_notice(&data, &notice, false));
        data.settings.notifications.system = true;
        data.settings.notifications.completion = false;
        assert!(!current_notice(&data, &notice, false));
        data.settings.notifications.completion = true;
        data.sessions[0].status = SessionStatus::Stopped;
        assert!(!current_notice(&data, &notice, false));
        data.sessions[0].status = SessionStatus::Completed;
        data.sessions[0].messages[0].id = "new-user-turn".into();
        assert!(!current_notice(&data, &notice, false));
        data.sessions[0].messages[0].id = "user1".into();
        data.projects.clear();
        assert!(!current_notice(&data, &notice, false));
        data.sessions.clear();
        assert!(!current_notice(&data, &notice, false));
    }
    #[test]
    fn closed_preferences_migrate_and_round_trip() {
        let prefs: Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(prefs, Preferences::default());
        for sound in ["glass", "ping", "pop", "submarine", "tink", "hero"] {
            let prefs: Preferences = serde_json::from_value(
                serde_json::json!({"permissionSound":sound,"permissions":false}),
            )
            .unwrap();
            let stored = serde_json::to_value(&prefs).unwrap();
            assert_eq!(stored["permissionSound"], sound);
            assert_eq!(stored["permissions"], false);
        }
        assert!(serde_json::from_value::<Preferences>(
            serde_json::json!({"completionSound":"/etc/passwd"})
        )
        .is_err());
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"test","title":"spoofed"})
        )
        .is_err());
    }
    #[test]
    fn deduplication_is_bounded_and_distinguishes_turns() {
        let mut seen = VecDeque::new();
        assert!(remember(&mut seen, "session:turn1"));
        assert!(!remember(&mut seen, "session:turn1"));
        assert!(remember(&mut seen, "session:turn2"));
        for index in 0..400 {
            remember(&mut seen, &format!("event:{index}"));
        }
        assert_eq!(seen.len(), 256);
    }
    #[test]
    fn event_switches_and_sounds_are_independent() {
        let prefs = Preferences {
            permissions: false,
            question_sound: Sound::Hero,
            ..Default::default()
        };
        assert_eq!(choice(&prefs, Kind::Permission), (false, Sound::Ping));
        assert_eq!(choice(&prefs, Kind::Question), (true, Sound::Hero));
    }
}
