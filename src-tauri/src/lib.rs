use crate::error::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

mod activity;
mod agent;
mod agent_output;
mod appearance;
mod astros;
mod attachment_platform;
mod attachments;
mod automations;
mod browser;
mod browser_mcp;
mod ci_autofix;
mod claude;
mod cli_output;
mod close;
mod codex;
mod commands;
mod commit_title;
mod computer;
mod computer_mcp;
mod context_text;
mod detect;
mod diagnostics;
mod dictation;
mod document_preview;
mod drafts;
mod editor;
mod error;
mod execution;
mod fs_tree;
mod git;
mod git_workspace;
mod github_inbox;
mod goals;
mod html_preview;
mod local_servers;
mod mcp_config;
mod mcp_stdio;
mod models;
mod new_project;
mod notifications;
mod opencode;
mod paths;
mod persist;
mod pr_watch;
mod project_look;
mod project_scripts;
mod provider_accounts;
mod provider_models;
mod provider_updates;
mod provider_usage;
mod provider_usage_http;
mod pty_term;
mod pull_requests;
mod redact;
mod remote;
mod reply_image;
mod secrets;
mod session_export;
mod side_chat;
mod sidebar;
mod simulator;
mod simulator_h264;
mod sirus_tools;
mod skills;
mod tasks;
mod team;
mod transcript;
mod transcript_view;
mod turn_review;
mod turn_undo;
mod window_attachment;
mod window_snap;
mod workspace_entries;
mod worktree;
mod worktree_cleanup;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Child mode used by provider CLIs: MCP over stdio, no window.
pub fn run_browser_mcp() -> i32 {
    browser_mcp::run_stdio()
}

/// Child mode used by provider CLIs for computer use: MCP over stdio, no window.
pub fn run_computer_mcp() -> i32 {
    computer_mcp::run_stdio()
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("sirus_code=info")),
        )
        .init();

    tauri::Builder::default()
        .manage(html_preview::HtmlPreviews::default())
        // Agent HTML rendered in the transcript, isolated on its own origin (ADR-072).
        .register_uri_scheme_protocol("sirus-preview", |ctx, request| {
            use tauri::Manager;
            html_preview::serve(
                &ctx.app_handle().state::<html_preview::HtmlPreviews>(),
                &request,
            )
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(native_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "sirus-quit" {
                // Custom native Quit goes through RunEvent::ExitRequested. macOS
                // predefined Quit calls NSApp terminate: and bypasses that event.
                app.exit(0);
            }
        })
        .setup(|app| {
            let resolver = app.path();
            let app_dir = resolver.app_data_dir()?;
            #[cfg(debug_assertions)]
            let app_dir = if let Some(path) = std::env::var_os("SIRUS_DATA_DIR") {
                let path = std::path::PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("SIRUS_DATA_DIR must be absolute".into());
                }
                path
            } else {
                app_dir
            };
            std::fs::create_dir_all(&app_dir)?;
            {
                // Keep a small crash breadcrumb without persisting panic payloads
                // or source paths, which may contain private user data.
                let log = app_dir.join("panic.log");
                let previous = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |info| {
                    use std::io::Write;
                    if let Ok(mut file) = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&log)
                    {
                        let line = info.location().map(|at| at.line()).unwrap_or_default();
                        let thread = std::thread::current()
                            .name()
                            .unwrap_or("unnamed")
                            .to_string();
                        let _ = writeln!(
                            file,
                            "{} [{thread}] panic at source line {line}",
                            chrono::Utc::now().to_rfc3339(),
                        );
                    }
                    previous(info);
                }));
            }
            let data_path = app_dir.join("state.json");
            browser_mcp::init(app.handle().clone(), app_dir.clone());
            secrets::init(&app_dir);
            remote::init(app.handle().clone(), &app_dir);
            simulator::init(app.handle().clone(), &app_dir);
            let worktree_root = app_dir.join("worktrees");
            std::fs::create_dir_all(&worktree_root)?;
            let data = persist::load_or_create(&data_path)?;
            sirus_tools::set_enabled(data.settings.agents_manage_sessions);
            computer_mcp::init(
                app.handle().clone(),
                app_dir.clone(),
                data.settings.computer_use_enabled,
            );
            app.manage(Arc::new(AppState {
                data_path,
                worktree_root,
                data: parking_lot::Mutex::new(data),
                agents: parking_lot::Mutex::new(HashMap::new()),
                ptys: parking_lot::Mutex::new(HashMap::new()),
                closing: std::sync::atomic::AtomicBool::new(false),
                attachment_picker: std::sync::atomic::AtomicBool::new(false),
                attachments: Default::default(),
                usage: provider_usage::UsageState::default(),
                accounts: provider_accounts::AccountState::default(),
                close_guard: parking_lot::Mutex::new(close::CloseGuard::default()),
                draft_checkpoint: parking_lot::Mutex::new(None),
                checkpoint_pending: Default::default(),
                catalogs: parking_lot::Mutex::new(HashMap::new()),
            }));
            appearance::schedule(app.handle(), app.state::<Arc<AppState>>().inner().clone());
            notifications::install(app.handle());
            automations::start(app.handle().clone());
            ci_autofix::start(app.handle().clone());
            pr_watch::start(app.handle().clone());
            {
                let state = app.state::<Arc<AppState>>().inner().clone();
                let settings = state.data.lock().settings.clone();
                window_snap::apply(app.handle(), &settings);
            }
            attachment_platform::install_paste_listener(
                app.handle(),
                app.state::<Arc<AppState>>().inner().clone(),
            );
            #[cfg(debug_assertions)]
            if std::env::var("SIRUS_DEVTOOLS").as_deref() == Ok("1") {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            html_preview::html_preview,
            team::team_action,
            side_chat::side_chat_action,
            github_inbox::pull_request_action,
            automations::automation_action,
            ci_autofix::ci_autofix_action,
            pr_watch::pr_watch_action,
            local_servers::local_server_action,
            simulator::simulator_action,
            tasks::task_action,
            astros::astro_action,
            window_snap::window_snap_action,
            project_look::project_look_action,
            project_scripts::project_scripts_action,
            worktree_cleanup::worktree_cleanup_action,
            project_look::project_auto_icon,
            session_export::export_conversation,
            turn_undo::undo_turn_changes,
            commands::trash_workspace_entry,
            skills::skill_action,
            mcp_config::mcp_action,
            notifications::notification_action,
            computer_mcp::computer_action,
            secrets::secret_action,
            remote::remote_action,
            remote::remote_pair,
            reply_image::reply_image,
            commands::load_state,
            provider_accounts::create_provider_account,
            provider_accounts::select_provider_account,
            provider_accounts::rename_provider_account,
            provider_accounts::login_provider_account,
            provider_accounts::cancel_provider_account_login,
            provider_usage::provider_usage,
            provider_usage::consume_codex_reset,
            provider_updates::provider_updates,
            provider_updates::update_providers,
            dictation::dictation_status,
            dictation::start_dictation,
            dictation::stop_dictation,
            browser::browser_open,
            browser::browser_close,
            browser::browser_state,
            browser::browser_new_tab,
            browser::browser_close_tab,
            browser::browser_select_tab,
            browser::browser_navigate,
            browser::browser_reload,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_set_bounds,
            browser::browser_annotate_start,
            browser::browser_annotate_finish,
            browser::browser_annotate_cancel,
            browser::browser_copy_link,
            browser::browser_capture,
            browser::browser_person_action,
            browser::browser_preview,
            commands::save_settings,
            commands::save_composer_draft,
            commands::save_context_text,
            commands::session_pull_request,
            commands::add_project,
            commands::create_project,
            commands::remove_project,
            commands::open_project,
            commands::rename_project,
            commands::git_identity,
            commands::git_status,
            commands::project_diff_stats,
            commands::git_diff,
            commands::list_branches,
            commands::checkout_branch,
            commands::create_branch,
            commands::git_commit,
            commands::git_workspace_action,
            commands::transcript_action,
            commit_title::commit_title_action,
            commands::git_push,
            commands::project_remote_url,
            commands::list_worktrees,
            commands::list_dir,
            commands::create_workspace_entry,
            commands::workspace_files,
            commands::detect_agents,
            commands::create_session,
            commands::fork_session,
            commands::handoff_session,
            commands::dismiss_handoff,
            commands::set_message_pinned,
            commands::set_session_agent,
            commands::rename_session,
            commands::delete_session,
            commands::send_prompt,
            commands::stop_agent,
            commands::respond_agent_request,
            commands::steer_turn,
            commands::start_terminal,
            commands::write_terminal,
            commands::resize_terminal,
            commands::stop_terminal,
            commands::host_info,
            commands::probe_provider,
            commands::list_provider_models,
            commands::set_session_model,
            pick_folder,
            attachments::pick_prompt_attachments,
            attachments::capture_prompt_window,
            document_preview::attachment_preview,
            turn_review::keep_turn_changes,
            attachments::paste_prompt_attachments,
            attachments::drop_prompt_attachments,
            attachments::release_prompt_attachments,
            pick_executable,
            open_path,
            open_external_url,
            editor::detect_editors,
            editor::editor_app_icons,
            editor::open_in_editor,
            editor::read_text_file,
            editor::write_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sirus Code")
        .run(|app, event| {
            match &event {
                tauri::RunEvent::Ready => {
                    // Tauri assigns its default Dock image during launch.
                    appearance::ready(app, app.state::<Arc<AppState>>().inner().clone());
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::ThemeChanged(_),
                    ..
                } if label == "main" => {
                    // OS palette changes can select different glass preferences.
                    appearance::schedule(app, app.state::<Arc<AppState>>().inner().clone());
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::DragDrop(drop),
                    ..
                } if label == "main" => {
                    // Finder drops (ADR-073): paths stay native; the UI only learns where it is.
                    attachments::window_drop(app, drop);
                }
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    request_close(app, || api.prevent_close());
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    request_close(app, || api.prevent_exit());
                }
                _ => {}
            }
            if matches!(event, tauri::RunEvent::Exit) {
                attachment_platform::remove_paste_listener();
                simulator::shutdown_all();
                secrets::clear_all();
                remote::shutdown();
                let state = app.state::<Arc<AppState>>();
                if let Err(error) = state.shutdown() {
                    tracing::error!(%error, "cannot persist application shutdown");
                }
            }
        });
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|path| path.to_string()));
    });
    Ok(rx.await.ok().flatten())
}

#[tauri::command]
async fn pick_executable(app: tauri::AppHandle) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_file(move |file| {
        let _ = tx.send(file.map(|path| path.to_string()));
    });
    Ok(rx.await.ok().flatten())
}

#[tauri::command]
async fn open_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let canonical = crate::paths::ensure_dir(std::path::Path::new(&path))?;
    let allowed = {
        let data = state.data.lock();
        let mut roots = data
            .projects
            .iter()
            .map(|project| std::path::PathBuf::from(&project.path))
            .collect::<Vec<_>>();
        roots.push(state.worktree_root.clone());
        if let Some(parent) = state.data_path.parent() {
            roots.push(parent.to_path_buf());
        }
        if let Some(path) = &data.settings.worktree_base_path {
            roots.push(path.into());
        }
        roots.iter().any(|root| {
            root.canonicalize()
                .is_ok_and(|root| canonical.starts_with(root))
        })
    };
    if !allowed {
        return Err(crate::error::Error::invalid_path(
            "directory is outside registered projects and Sirus Code data",
        ));
    }
    app.opener()
        .open_path(canonical.display().to_string(), None::<&str>)
        .map_err(|err| crate::error::Error::new("opener", err.to_string()))?;
    Ok(())
}

/// Strict external link policy: http(s) only, no credentials in the URL, and a
/// fixed host allowlist. Local development servers are always allowed.
fn validate_external_url(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty()
        || value.len() > 2048
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(crate::error::Error::invalid_path("URL is not allowed"));
    }
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .ok_or_else(|| crate::error::Error::invalid_path("URL is not allowed"))?;
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return Err(crate::error::Error::invalid_path("URL is not allowed"));
    }
    // Reject any userinfo so a host-looking prefix cannot hide the real target.
    let (host_port, _) = match authority.split_once('@') {
        Some(_) => {
            return Err(crate::error::Error::invalid_path("URL is not allowed"));
        }
        None => (authority, ()),
    };
    let host = if let Some(stripped) = host_port.strip_prefix('[') {
        stripped
            .split(']')
            .next()
            .ok_or_else(|| crate::error::Error::invalid_path("URL is not allowed"))?
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    let allowed = host.eq_ignore_ascii_case("github.com")
        || host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1";
    if !allowed {
        return Err(crate::error::Error::invalid_path("URL host is not allowed"));
    }
    Ok(value.to_string())
}

#[tauri::command]
async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| crate::error::Error::new("opener", err.to_string()))?;
    Ok(())
}

fn native_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let menu = tauri::menu::Menu::default(app)?;
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{AboutMetadata, MenuItem, PredefinedMenuItem, Submenu};
        let metadata = AboutMetadata {
            name: Some(app.package_info().name.clone()),
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        };
        let application = Submenu::with_items(
            app,
            app.package_info().name.clone(),
            true,
            &[
                &PredefinedMenuItem::about(app, None, Some(metadata))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(
                    app,
                    "sirus-quit",
                    "Quit Sirus Code",
                    true,
                    Some("CmdOrCtrl+Q"),
                )?,
            ],
        )?;
        // Tauri's default macOS first submenu is the application menu, whose
        // predefined Quit must be replaced before the menu becomes active.
        menu.remove_at(0)?;
        menu.insert(&application, 0)?;
    }
    Ok(menu)
}

// Native memory, never renderer state,
// decides whether a process or its spawn admission needs confirmation.
fn request_close(app: &tauri::AppHandle, prevent: impl FnOnce()) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let state = app.state::<Arc<AppState>>();
    let (decision, portuguese) = {
        // Same data → process lock order as admission/shutdown. Do not mutate
        // execution state while the user is deciding.
        let data = state.data.lock();
        let agents = !state.agents.lock().is_empty();
        let starting = data
            .sessions
            .iter()
            .any(|s| s.status == models::SessionStatus::Starting);
        let decision =
            state
                .close_guard
                .lock()
                .request(data.settings.confirm_close_running, agents, starting);
        (decision, data.settings.locale == "pt-BR")
    };
    match decision {
        close::Decision::Allow => {}
        close::Decision::Pending => prevent(),
        close::Decision::Ask => {
            prevent();
            let (title, message, accept, cancel) = if portuguese {
                ("Fechar Sirus Code?", "Há sessões em execução. Fechar interromperá os agentes. As sessões e suas mensagens serão mantidas.", "Fechar e interromper", "Continuar executando")
            } else {
                ("Close Sirus Code?", "Sessions are running. Closing will interrupt agents. Sessions and their messages will be kept.", "Close and interrupt", "Keep running")
            };
            let app = app.clone();
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
                        callback_app.exit(0);
                    }
                });
        }
    }
}
