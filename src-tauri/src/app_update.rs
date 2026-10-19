//! In-app updates (ADR-140). The updater plugin runs from Rust only: the renderer
//! has no updater permission and reaches this module through one closed command,
//! `app_update_action { status | check | install | restart }`, and the
//! `app-update` event. An update is a signed `.app.tar.gz` named by the
//! `latest.json` of the newest GitHub release; the plugin verifies its minisign
//! signature against the public key in `tauri.conf.json` before installing it.
//! Installing and relaunching happen only when the person asks, and the relaunch
//! goes through the same close guard as quitting (ADR-090), so running agents
//! are never interrupted without the running-agents confirmation.
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::commands::AppState;
use crate::error::{Error, Result};

/// The first automatic check waits for the window and the agents to settle.
const START_DELAY: Duration = Duration::from_secs(20);
/// Focusing the window checks again only after this long since the last check.
const FOCUS_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
/// Download progress is published at most this often.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);
/// Release notes longer than this are cut for the toast and Settings.
const MAX_NOTES: usize = 2000;
const MAX_ERROR: usize = 300;
const EVENT: &str = "app-update";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Installing,
    /// Installed on disk; the new version runs after the next restart.
    Installed,
    Failed,
}

/// What the renderer sees, both as the command's reply and as the `app-update` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub current_version: String,
    pub phase: Phase,
    /// The newer version on offer, once a check found one.
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    /// When a check last reached the release server (RFC 3339).
    pub checked_at: Option<String>,
    /// Whether this build checks on its own (release builds only).
    pub automatic: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    /// The current status, without touching the network.
    Status,
    /// Asks the release server now.
    Check,
    /// Downloads, verifies and installs the update on offer, then restarts through the close guard.
    Install,
    /// Downloads, verifies and installs it without restarting: it waits for Restart (or the next launch).
    Download,
    /// Restarts into an update installed earlier, through the close guard.
    Restart,
}

struct Inner {
    status: Status,
    pending: Option<Update>,
    /// A check or download is under way.
    busy: bool,
    last_attempt: Option<Instant>,
}

static UPDATES: LazyLock<Mutex<Inner>> = LazyLock::new(|| {
    Mutex::new(Inner {
        status: Status {
            current_version: String::new(),
            phase: Phase::Idle,
            version: None,
            notes: None,
            date: None,
            downloaded: 0,
            total: None,
            error: None,
            checked_at: None,
            automatic: automatic(),
        },
        pending: None,
        busy: false,
        last_attempt: None,
    })
});

/// Development builds (the owner's daily `build:desktop` app and `tauri dev`) never
/// check on their own; Settings can still check by hand.
fn automatic() -> bool {
    !cfg!(debug_assertions)
}

/// The person's update preferences: (look on their own, download what is found).
fn preferences(app: &AppHandle) -> (bool, bool) {
    let state = app.state::<Arc<AppState>>();
    let data = state.data.lock();
    (
        data.settings.app_update_auto_check,
        data.settings.app_update_auto_download,
    )
}

/// Whether a focus should check again: only after a first check and a long pause.
pub fn due(last: Option<Instant>, now: Instant, interval: Duration) -> bool {
    last.is_some_and(|last| now.saturating_duration_since(last) >= interval)
}

/// Release notes as shown: trimmed, empty means none, long ones cut on a character boundary.
pub fn notes(body: Option<&str>) -> Option<String> {
    let body = body?.trim();
    if body.is_empty() {
        return None;
    }
    if body.chars().count() <= MAX_NOTES {
        return Some(body.to_string());
    }
    let cut: String = body.chars().take(MAX_NOTES).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// A short, single-line failure message; the release feed missing reads as such.
pub fn failure(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("valid release json") || lower.contains("404") {
        return "No update information is published for this version yet.".into();
    }
    let line = message.lines().next().unwrap_or_default().trim();
    line.chars().take(MAX_ERROR).collect()
}

fn snapshot(app: &AppHandle) -> Status {
    let mut inner = UPDATES.lock();
    if inner.status.current_version.is_empty() {
        inner.status.current_version = app.package_info().version.to_string();
    }
    inner.status.clone()
}

fn publish(app: &AppHandle) -> Status {
    let status = snapshot(app);
    let _ = app.emit(EVENT, &status);
    status
}

/// Starts the delayed first check (release builds only).
pub fn start(app: &AppHandle) {
    if !automatic() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(START_DELAY).await;
        automatic_check(&app).await;
    });
}

/// A check of its own, when the person keeps them on; with background downloads on, a
/// version found is downloaded and installed right away and waits for a restart.
async fn automatic_check(app: &AppHandle) {
    let (look, download) = preferences(app);
    if !look {
        return;
    }
    if check(app, false).await.phase == Phase::Available && download {
        install(app, false).await;
    }
}

/// The main window gained focus: checks again when the last check is old enough.
pub fn focused(app: &AppHandle) {
    if !automatic() {
        return;
    }
    let due = {
        let inner = UPDATES.lock();
        !inner.busy && due(inner.last_attempt, Instant::now(), FOCUS_INTERVAL)
    };
    if due {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { automatic_check(&app).await });
    }
}

/// Asks the release server. An automatic check stays silent when it fails (offline,
/// no feed yet); a manual one reports the failure.
async fn check(app: &AppHandle, manual: bool) -> Status {
    {
        let mut inner = UPDATES.lock();
        let settled = matches!(
            inner.status.phase,
            Phase::Downloading | Phase::Installing | Phase::Installed
        );
        if inner.busy || settled {
            drop(inner);
            return snapshot(app);
        }
        inner.busy = true;
        inner.last_attempt = Some(Instant::now());
        if manual {
            inner.status.phase = Phase::Checking;
            inner.status.error = None;
        }
    }
    if manual {
        publish(app);
    }
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    {
        let mut inner = UPDATES.lock();
        inner.busy = false;
        match result {
            Ok(Some(update)) => {
                inner.status.phase = Phase::Available;
                inner.status.version = Some(update.version.clone());
                inner.status.notes = notes(update.body.as_deref());
                inner.status.date = update.date.map(|date| date.to_string());
                inner.status.error = None;
                inner.status.checked_at = Some(chrono::Utc::now().to_rfc3339());
                inner.pending = Some(update);
            }
            Ok(None) => {
                inner.status.phase = Phase::UpToDate;
                inner.status.version = None;
                inner.status.notes = None;
                inner.status.date = None;
                inner.status.error = None;
                inner.status.checked_at = Some(chrono::Utc::now().to_rfc3339());
                inner.pending = None;
            }
            Err(error) => {
                tracing::info!(%error, manual, "update check failed");
                if manual {
                    inner.status.phase = Phase::Failed;
                    inner.status.error = Some(failure(&error.to_string()));
                } else if inner.status.phase == Phase::Checking {
                    inner.status.phase = Phase::Idle;
                }
            }
        }
    }
    publish(app)
}

fn fail(app: &AppHandle, message: String) -> Status {
    {
        let mut inner = UPDATES.lock();
        inner.busy = false;
        inner.status.phase = Phase::Failed;
        inner.status.error = Some(failure(&message));
    }
    publish(app)
}

async fn install(app: &AppHandle, restart: bool) -> Status {
    let pending = {
        let inner = UPDATES.lock();
        match inner.status.phase {
            Phase::Downloading | Phase::Installing => {
                drop(inner);
                return snapshot(app);
            }
            Phase::Installed => {
                drop(inner);
                if restart {
                    relaunch(app);
                }
                return snapshot(app);
            }
            _ => inner.pending.clone(),
        }
    };
    let update = match pending {
        Some(update) => update,
        None => {
            check(app, true).await;
            match UPDATES.lock().pending.clone() {
                Some(update) => update,
                None => return snapshot(app),
            }
        }
    };
    {
        let mut inner = UPDATES.lock();
        if inner.busy {
            drop(inner);
            return snapshot(app);
        }
        inner.busy = true;
        inner.status.phase = Phase::Downloading;
        inner.status.downloaded = 0;
        inner.status.total = None;
        inner.status.error = None;
    }
    publish(app);
    let progress_app = app.clone();
    let mut last_publish = Instant::now();
    // The plugin checks the signature against the configured public key before returning the bytes.
    let bytes = match update
        .download(
            move |chunk, total| {
                {
                    let mut inner = UPDATES.lock();
                    inner.status.downloaded += chunk as u64;
                    inner.status.total = total;
                }
                if last_publish.elapsed() >= PROGRESS_INTERVAL {
                    last_publish = Instant::now();
                    publish(&progress_app);
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => return fail(app, error.to_string()),
    };
    UPDATES.lock().status.phase = Phase::Installing;
    publish(app);
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match installed {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return fail(app, error.to_string()),
        Err(error) => return fail(app, error.to_string()),
    }
    {
        let mut inner = UPDATES.lock();
        inner.busy = false;
        inner.pending = None;
        inner.status.phase = Phase::Installed;
    }
    let status = publish(app);
    if restart {
        relaunch(app);
    }
    status
}

/// Restarts into the installed update through the close guard: with agents running
/// (and the running-agents confirmation on) the person confirms first, as when quitting.
fn relaunch(app: &AppHandle) {
    use crate::close::Decision;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let state = app.state::<Arc<AppState>>();
    let (decision, portuguese) = {
        // Same data → process lock order as `request_close`.
        let data = state.data.lock();
        let agents = !state.agents.lock().is_empty();
        let starting = data
            .sessions
            .iter()
            .any(|session| session.status == crate::models::SessionStatus::Starting);
        let decision =
            state
                .close_guard
                .lock()
                .request(data.settings.confirm_close_running, agents, starting);
        (decision, data.settings.locale == "pt-BR")
    };
    match decision {
        // `request_restart` raises ExitRequested, which the guard now allows, then Exit,
        // so the usual shutdown (state saved, agents stopped) runs before the relaunch.
        Decision::Allow => app.request_restart(),
        // A close confirmation is already open; its answer decides.
        Decision::Pending => {}
        Decision::Ask => {
            let (title, message, accept, cancel) = if portuguese {
                (
                    "Reiniciar para atualizar?",
                    "Há sessões em execução. Reiniciar interromperá os agentes. As sessões e suas mensagens serão mantidas. A atualização também entra na próxima vez que você abrir o Sirus Code.",
                    "Reiniciar e interromper",
                    "Continuar executando",
                )
            } else {
                (
                    "Restart to update?",
                    "Sessions are running. Restarting will interrupt agents. Sessions and their messages will be kept. The update also applies the next time you open Sirus Code.",
                    "Restart and interrupt",
                    "Keep running",
                )
            };
            let callback_app = app.clone();
            let mut dialog = app.dialog().message(message);
            if let Some(window) = app.get_webview_window("main") {
                dialog = dialog.parent(&window);
            }
            dialog
                .title(title)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    accept.into(),
                    cancel.into(),
                ))
                .show(move |accepted| {
                    callback_app
                        .state::<Arc<AppState>>()
                        .close_guard
                        .lock()
                        .answer(accepted);
                    if accepted {
                        callback_app.request_restart();
                    }
                });
        }
    }
}

/// Closed renderer surface for updates (desktop only; a paired device never reaches it).
#[tauri::command]
pub async fn app_update_action(app: AppHandle, action: Action) -> Result<Status> {
    Ok(match action {
        Action::Status => snapshot(&app),
        Action::Check => check(&app, true).await,
        Action::Install => install(&app, true).await,
        Action::Download => install(&app, false).await,
        Action::Restart => {
            if snapshot(&app).phase != Phase::Installed {
                return Err(Error::new("update", "No update is waiting for a restart."));
            }
            relaunch(&app);
            snapshot(&app)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_checks_only_after_a_first_check_and_a_long_pause() {
        let start = Instant::now();
        let hour = Duration::from_secs(3600);
        assert!(!due(None, start, FOCUS_INTERVAL));
        assert!(!due(Some(start), start + hour, FOCUS_INTERVAL));
        assert!(due(Some(start), start + 4 * hour, FOCUS_INTERVAL));
    }

    #[test]
    fn notes_are_trimmed_and_bounded() {
        assert_eq!(notes(None), None);
        assert_eq!(notes(Some("  \n ")), None);
        assert_eq!(notes(Some(" Fixes \n")).as_deref(), Some("Fixes"));
        let long = "é".repeat(MAX_NOTES + 10);
        let cut = notes(Some(&long)).unwrap();
        assert_eq!(cut.chars().count(), MAX_NOTES + 1);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn failures_are_one_short_line() {
        assert_eq!(
            failure("Could not fetch a valid release JSON from the remote"),
            "No update information is published for this version yet."
        );
        assert_eq!(failure("first\nsecond"), "first");
        assert_eq!(failure(&"x".repeat(1000)).len(), MAX_ERROR);
    }

    #[test]
    fn actions_are_a_closed_set() {
        assert!(serde_json::from_str::<Action>(r#"{"type":"check"}"#).is_ok());
        assert!(serde_json::from_str::<Action>(r#"{"type":"install"}"#).is_ok());
        assert!(serde_json::from_str::<Action>(r#"{"type":"download"}"#).is_ok());
        assert!(serde_json::from_str::<Action>(r#"{"type":"downloadUrl","url":"x"}"#).is_err());
        assert!(serde_json::from_str::<Action>(r#"{"url":"x"}"#).is_err());
    }
}
