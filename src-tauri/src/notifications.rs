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
    /// A turn ended in an error (ADR-086); follows the completion switch and sound.
    Failure,
    /// A snoozed conversation came back (ADR-103). The person asked for it, so no event
    /// switch hides it; the channels (toasts, system, sounds, foreground) still apply.
    Reminder,
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
    if session.status == SessionStatus::Failed {
        return session
            .messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::User)
            .map(|message| {
                vec![(
                    format!("{}:failed:{}", session.id, message.id),
                    Kind::Failure,
                )]
            })
            .unwrap_or_default();
    }
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
        Kind::Completion | Kind::Failure => (prefs.completion, prefs.completion_sound),
        Kind::Reminder => (true, prefs.completion_sound),
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
        (Kind::Failure, true) => "A tarefa falhou",
        (Kind::Failure, false) => "Task failed",
        (Kind::Reminder, true) => "Lembrete",
        (Kind::Reminder, false) => "Reminder",
    }
}
/// What a phone alert adds under the title (ADR-086): the command or files awaiting
/// approval, the question asked, the start of the final answer or the error.
fn detail(session: &Session, key: &str, kind: Kind, portuguese: bool) -> Option<String> {
    let line = |text: &str| -> Option<String> {
        let text = text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with("```"))?
            .trim_start_matches(['#', '>', '-', '*', ' '])
            .replace(['*', '`'], "");
        (!text.is_empty()).then(|| {
            text.chars()
                .filter(|ch| !ch.is_control())
                .take(140)
                .collect()
        })
    };
    match kind {
        Kind::Permission | Kind::Question => {
            let request_id = key.rsplit(':').next()?;
            let request = session
                .pending_requests
                .iter()
                .find(|request| request.request_id == request_id)?;
            match &request.kind {
                PendingRequestKind::Command { command, .. } => {
                    line(command).map(|command| format!("$ {command}"))
                }
                PendingRequestKind::FileChange { changes, .. } => Some(if portuguese {
                    format!("Alterar {} arquivo(s)", changes.len())
                } else {
                    format!("Change {} file(s)", changes.len())
                }),
                PendingRequestKind::UserInput { questions } => questions
                    .first()
                    .and_then(|question| line(&question.question)),
                PendingRequestKind::Tool { name, .. } => line(name),
            }
        }
        Kind::Completion => session
            .messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::Agent)
            .and_then(|message| line(&message.content)),
        Kind::Failure => session.last_error.as_deref().and_then(line),
        Kind::Reminder => None,
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
/// "Project · Session", or the name once when the session is titled like its project.
fn notice_body(project: &str, session: &str) -> String {
    let (project, session) = (bounded_label(project), bounded_label(session));
    if session.trim().is_empty() || session.trim().eq_ignore_ascii_case(project.trim()) {
        project
    } else {
        format!("{project} · {session}")
    }
}

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
    crate::remote::notify(&notice.title, &notice.body, "");
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

/// The identity of one snooze reminder (ADR-103): a session returns once per wake.
fn reminder_key(session: &Session) -> Option<String> {
    let at = session.snooze_reminder_at.as_deref()?;
    session
        .snoozed_until
        .is_none()
        .then(|| format!("{}:reminder:{at}", session.id))
}

/// "Reminder" with the conversation's title, when a snoozed session comes back (ADR-103).
/// Called by the native snooze timer, also while the window is hidden; a click opens the
/// session like any activity alert.
pub fn remind(app: &AppHandle, state: &Arc<AppState>, session_id: &str) {
    let app = app.clone();
    let dispatcher = app.clone();
    let state = state.clone();
    let id = session_id.to_string();
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
        let Some(key) = reminder_key(session) else {
            return;
        };
        let prefs = data.settings.notifications.clone();
        let portuguese = data.settings.locale == "pt-BR";
        let notice = Notice {
            created_at: chrono::Utc::now().timestamp_millis(),
            id: key,
            session_id: id.clone(),
            kind: Kind::Reminder,
            title: copy(Kind::Reminder, portuguese).into(),
            body: notice_body(&project.name, &session.title),
        };
        drop(data);
        if !remember(
            &mut app.state::<NotificationState>().seen.lock(),
            &notice.id,
        ) {
            return;
        }
        let foreground = app
            .get_webview_window("main")
            .is_some_and(|window| window.is_focused().unwrap_or(true));
        let eligible = !foreground || prefs.foreground;
        crate::remote::notify(&notice.title, &notice.body, &notice.session_id);
        if prefs.toasts {
            let _ = app.emit("notification-activity", &notice);
        }
        #[cfg(target_os = "macos")]
        {
            if prefs.sounds && eligible {
                let _ = platform::play(choice(&prefs, Kind::Reminder).1);
            }
            if prefs.system && eligible {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = platform::show(&app, &notice).await {
                        tracing::debug!(%error, "system reminder unavailable");
                    }
                });
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = eligible;
    });
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
        let body = notice_body(&project.name, &session.title);
        let portuguese = data.settings.locale == "pt-BR";
        let foreground = app
            .get_webview_window("main")
            .is_some_and(|window| window.is_focused().unwrap_or(true));
        let eligible = !foreground || prefs.foreground;
        let notices: Vec<_> = expected
            .into_iter()
            .filter(|candidate| current.contains(candidate))
            .collect();
        let details: std::collections::HashMap<String, Option<String>> = notices
            .iter()
            .map(|(key, kind)| (key.clone(), detail(session, key, *kind, portuguese)))
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
            // Paired phones get the alert whether or not the Mac window has focus (ADR-082),
            // with what it is about under the project and conversation (ADR-086).
            let phone_body = match &details.get(&notice.id) {
                Some(Some(detail)) => format!("{}\n{detail}", notice.body),
                _ => notice.body.clone(),
            };
            crate::remote::notify(&notice.title, &phone_body, &notice.session_id);
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
        && if notice.kind == Kind::Reminder {
            reminder_key(session).as_deref() == Some(notice.id.as_str())
        } else {
            candidates(session).contains(&(notice.id.clone(), notice.kind))
        }
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

    #[test]
    fn a_session_named_like_its_project_shows_the_name_once() {
        assert_eq!(notice_body("dp-inchurch", "dp-inchurch"), "dp-inchurch");
        assert_eq!(
            notice_body("dp-inchurch", "Ajustes do rateio"),
            "dp-inchurch · Ajustes do rateio"
        );
    }
    fn session() -> Session {
        serde_json::from_value(serde_json::json!({
            "id": "session", "title": "Work", "projectId":"project", "agent":"codex", "status":"running",
            "createdAt":"2026-10-02T00:00:00Z", "lastActivityAt":"2026-10-02T00:00:00Z",
            "worktree":{"path":"/workspace", "branch":"main", "isolated":false}, "lastError":null,
            "messages":[{"id":"user1", "sessionId":"session", "role":"user", "content":"private prompt", "createdAt":"2026-10-02T00:00:00Z", "streaming":false}]
        })).unwrap()
    }
    #[test]
    fn only_settled_turns_notify_and_each_user_turn_is_distinct() {
        let mut session = session();
        for status in [
            SessionStatus::Running,
            SessionStatus::Starting,
            SessionStatus::Stopped,
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
        // A failed turn alerts once, as a failure (ADR-086).
        session.status = SessionStatus::Failed;
        let failed = candidates(&session);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].1, Kind::Failure);
        assert!(failed[0].0.contains(":failed:"));
    }
    #[test]
    fn phone_alerts_say_what_they_are_about() {
        let mut session = session();
        session.status = SessionStatus::Waiting;
        session
            .pending_requests
            .push(crate::models::PendingRequest {
                request_id: "r1".into(),
                generation: "g".into(),
                turn_id: "t".into(),
                item_id: "i".into(),
                kind: PendingRequestKind::Command {
                    command: "vercel deploy --prod\n--yes".into(),
                    cwd: None,
                    reason: None,
                },
            });
        assert_eq!(
            detail(&session, "s:g:t:r1", Kind::Permission, true).as_deref(),
            Some("$ vercel deploy --prod")
        );
        session.last_error = Some("Usage limit reached".into());
        assert_eq!(
            detail(&session, "", Kind::Failure, true).as_deref(),
            Some("Usage limit reached")
        );
        assert_eq!(
            detail(&session, "s:g:t:missing", Kind::Permission, true),
            None
        );
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
    fn a_reminder_is_current_until_the_session_is_snoozed_again_or_opened() {
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
        assert_eq!(reminder_key(&session), None);
        session.snooze_reminder_at = Some("2026-10-09T09:00:00Z".into());
        let id = reminder_key(&session).unwrap();
        data.sessions.push(session);
        let notice = Notice {
            id,
            kind: Kind::Reminder,
            session_id: "session".into(),
            title: "Lembrete".into(),
            body: "Project · Work".into(),
            created_at: 0,
        };
        // Reminders follow the channels, not the completion switch.
        data.settings.notifications.completion = false;
        assert!(current_notice(&data, &notice, false));
        assert!(!current_notice(&data, &notice, true));
        data.sessions[0].snoozed_until = Some("2026-10-10T09:00:00Z".into());
        assert!(!current_notice(&data, &notice, false));
        data.sessions[0].snoozed_until = None;
        data.sessions[0].snooze_reminder_at = None;
        assert!(!current_notice(&data, &notice, false));
        assert_eq!(copy(Kind::Reminder, true), "Lembrete");
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
