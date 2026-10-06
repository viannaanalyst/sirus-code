//! Browser MCP: the app hosts the browser; each provider CLI spawns this same
//! binary with `--mcp-browser`, which speaks MCP over stdio and forwards tool
//! calls to the app over a private Unix socket with a per-session token.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::Emitter;

pub const SOCKET_ENV: &str = "SWITCHYARD_BROWSER_SOCKET";
pub const TOKEN_ENV: &str = "SWITCHYARD_BROWSER_TOKEN";
const MCP_SERVER_NAME: &str = "switchyard_browser";

#[derive(Clone)]
pub struct Endpoint {
    pub token: String,
    pub socket: PathBuf,
}

static ENDPOINTS: Mutex<Option<HashMap<String, Endpoint>>> = Mutex::new(None);
static APP: OnceLock<(tauri::AppHandle, PathBuf)> = OnceLock::new();

fn endpoint_map() -> parking_lot::MutexGuard<'static, Option<HashMap<String, Endpoint>>> {
    ENDPOINTS.lock()
}

pub(crate) fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Registers the app handle and data directory, then starts the socket server.
pub fn init(app: tauri::AppHandle, data_dir: PathBuf) {
    let dir = data_dir.join("browser-mcp");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let socket = dir.join("bridge.sock");
    if APP.set((app.clone(), socket.clone())).is_err() {
        return;
    }
    start_server(app, socket);
}

/// Returns (creating once) the endpoint bound to a session.
pub fn ensure_endpoint(session_id: &str) -> Option<Endpoint> {
    let (_, socket) = APP.get()?;
    let mut guard = endpoint_map();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(endpoint) = map.get(session_id) {
        return Some(endpoint.clone());
    }
    let endpoint = Endpoint {
        token: new_token(),
        socket: socket.clone(),
    };
    map.insert(session_id.to_string(), endpoint.clone());
    Some(endpoint)
}

/// Claude reads a JSON config file; the token travels in the file (0600).
pub fn claude_mcp_config(session_id: &str) -> Option<PathBuf> {
    let endpoint = ensure_endpoint(session_id)?;
    let (_, socket) = APP.get()?;
    let exe = std::env::current_exe().ok()?;
    let dir = socket.parent()?;
    let path = dir.join(format!("{session_id}.claude.json"));
    let mut config = json!({
        "mcpServers": {
            MCP_SERVER_NAME: {
                "command": exe.to_string_lossy(),
                "args": ["--mcp-browser"],
                "env": {
                    SOCKET_ENV: endpoint.socket.to_string_lossy(),
                    TOKEN_ENV: endpoint.token,
                }
            }
        }
    });
    if let Some(computer) = crate::computer_mcp::claude_server(session_id) {
        config["mcpServers"][crate::computer_mcp::SERVER_NAME] = computer;
    }
    std::fs::write(&path, serde_json::to_vec(&config).ok()?).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Some(path)
}

#[cfg(target_os = "macos")]
fn start_server(app: tauri::AppHandle, socket: PathBuf) {
    let _ = std::fs::remove_file(&socket);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::UnixListener::bind(&socket) {
            Ok(listener) => listener,
            Err(error) => {
                tracing::warn!(%error, "browser mcp: cannot bind bridge socket");
                return;
            }
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
        }
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                handle_bridge_connection(stream, app).await;
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn start_server(_app: tauri::AppHandle, _socket: PathBuf) {}

#[cfg(target_os = "macos")]
async fn handle_bridge_connection(stream: tokio::net::UnixStream, app: tauri::AppHandle) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.len() > 256 * 1024 {
            break;
        }
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let response = bridge_request(&app, &request).await;
        let Ok(encoded) = serde_json::to_string(&response) else {
            continue;
        };
        if write.write_all(encoded.as_bytes()).await.is_err() {
            break;
        }
        if write.write_all(b"\n").await.is_err() {
            break;
        }
    }
}

#[cfg(not(target_os = "macos"))]
async fn handle_bridge_connection(_stream: tokio::net::UnixStream, _app: tauri::AppHandle) {}

#[cfg(target_os = "macos")]
async fn bridge_request(app: &tauri::AppHandle, request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let Some(token) = request.get("token").and_then(Value::as_str) else {
        return json!({ "id": id, "ok": false, "error": "missing token" });
    };
    let session_id = {
        let guard = endpoint_map();
        guard.as_ref().and_then(|map| {
            map.iter()
                .find(|(_, endpoint)| constant_time_eq(endpoint.token.as_bytes(), token.as_bytes()))
                .map(|(session_id, _)| session_id.clone())
        })
    };
    let Some(session_id) = session_id else {
        return json!({ "id": id, "ok": false, "error": "unknown browser session" });
    };
    let tool = request
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let arguments = request
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let owned_app = app.clone();
    let result =
        tokio::task::spawn_blocking(move || execute(&owned_app, &session_id, &tool, arguments))
            .await
            .unwrap_or_else(|_| Err("the browser operation did not complete".into()));
    match result {
        Ok(value) => json!({ "id": id, "ok": true, "result": value }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    }
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

pub(crate) fn session_owned(app: &tauri::AppHandle, session_id: &str) -> bool {
    use tauri::Manager;
    let state = app.state::<std::sync::Arc<crate::commands::AppState>>();
    let owned = state
        .data
        .lock()
        .sessions
        .iter()
        .any(|session| session.id == session_id);
    owned
}

fn arg_str(args: &Value, key: &str, limit: usize) -> Option<String> {
    let value = args.get(key)?.as_str()?.trim();
    if value.chars().count() > limit || value.chars().any(char::is_control) {
        return None;
    }
    Some(value.to_string())
}

fn valid_ref(value: &str) -> bool {
    value.is_empty()
        || ((2..=5).contains(&value.len())
            && value.starts_with('e')
            && value[1..].chars().all(|c| c.is_ascii_digit()))
}

fn valid_selector(value: &str) -> bool {
    value.chars().count() <= 300 && !value.chars().any(char::is_control)
}

fn action_result(raw: String) -> Result<Value, String> {
    let parsed: Value =
        serde_json::from_str(&raw).map_err(|_| "invalid page response".to_string())?;
    if parsed.get("interrupted").and_then(Value::as_bool) == Some(true) {
        return Err("the page was used by the person and the action was interrupted".into());
    }
    if parsed.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("the action failed")
            .to_string());
    }
    Ok(parsed)
}

#[cfg(target_os = "macos")]
fn execute(
    app: &tauri::AppHandle,
    session_id: &str,
    tool: &str,
    args: Value,
) -> Result<Value, String> {
    use crate::browser::platform as browser;
    let map_error = |error: crate::error::Error| error.to_string();
    if !session_owned(app, session_id) {
        return Err("this session no longer exists".into());
    }
    if tool.starts_with("simulator_") {
        // The same per-session bridge serves the iOS Simulator tools (ADR-066).
        return tauri::async_runtime::block_on(crate::simulator::execute(
            app, session_id, tool, args,
        ));
    }
    match tool {
        "browser_status" | "browser_tabs" => browser::mcp_status(app, session_id)
            .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
            .map_err(map_error),
        "browser_open" => {
            let url = args
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|url| crate::browser::is_allowed_browser_url(url));
            browser::mcp_open(app, session_id, url)
                .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
                .map_err(map_error)
        }
        "browser_navigate" => {
            let url = arg_str(&args, "url", 2048)
                .filter(|url| crate::browser::is_allowed_browser_url(url))
                .ok_or_else(|| "only http(s) URLs can be opened".to_string())?;
            browser::mcp_navigate(app, session_id, &url)
                .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
                .map_err(map_error)
        }
        "browser_back" => browser::mcp_back(app, session_id)
            .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
            .map_err(map_error),
        "browser_forward" => browser::mcp_forward(app, session_id)
            .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
            .map_err(map_error),
        "browser_reload" => browser::mcp_reload(app, session_id)
            .map(|state| serde_json::to_value(state).unwrap_or(Value::Null))
            .map_err(map_error),
        "browser_close" => browser::mcp_close(app, session_id)
            .map(|_| json!({ "closed": true }))
            .map_err(map_error),
        "browser_screenshot" => browser::mcp_capture(app, session_id)
            .map(|data| {
                // The model receives the image; the person also sees it as a
                // composer attachment for the owning session.
                let _ = app.emit(
                    "browser-capture",
                    json!({ "sessionId": session_id, "data": data }),
                );
                json!({ "image": { "mimeType": "image/png", "data": data } })
            })
            .map_err(map_error),
        "browser_snapshot" => browser::mcp_snapshot(app, session_id)
            .map_err(map_error)
            .and_then(|raw| serde_json::from_str(&raw).map_err(|_| "invalid snapshot".into())),
        "browser_click" => {
            let reference = arg_str(&args, "ref", 8).unwrap_or_default();
            let selector = arg_str(&args, "selector", 300).unwrap_or_default();
            if !valid_ref(&reference) || !valid_selector(&selector) {
                return Err("invalid element reference".into());
            }
            if reference.is_empty() && selector.is_empty() {
                return Err("provide a ref from browser_snapshot or a selector".into());
            }
            browser::mcp_click(app, session_id, &reference, &selector)
                .map_err(map_error)
                .and_then(action_result)
        }
        "browser_type" => {
            let reference = arg_str(&args, "ref", 8).unwrap_or_default();
            let selector = arg_str(&args, "selector", 300).unwrap_or_default();
            let value = arg_str(&args, "text", 16 * 1024).unwrap_or_default();
            let submit = args.get("submit").and_then(Value::as_bool).unwrap_or(false);
            if !valid_ref(&reference) || !valid_selector(&selector) {
                return Err("invalid element reference".into());
            }
            if reference.is_empty() && selector.is_empty() {
                return Err("provide a ref from browser_snapshot or a selector".into());
            }
            browser::mcp_type(app, session_id, &reference, &selector, &value, submit)
                .map_err(map_error)
                .and_then(action_result)
        }
        "browser_scroll" => {
            let dy = args.get("dy").and_then(Value::as_f64).unwrap_or(0.0);
            if !dy.is_finite() || dy.abs() > 20_000.0 {
                return Err("invalid scroll amount".into());
            }
            browser::mcp_scroll(app, session_id, dy)
                .map_err(map_error)
                .and_then(action_result)
        }
        "browser_logs" => {
            let clear = args.get("clear").and_then(Value::as_bool).unwrap_or(false);
            browser::mcp_logs(app, session_id, clear)
                .map_err(map_error)
                .and_then(|raw| serde_json::from_str(&raw).map_err(|_| "invalid logs".into()))
        }
        _ => Err("unknown browser tool".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn execute(
    _app: &tauri::AppHandle,
    _session_id: &str,
    _tool: &str,
    _args: Value,
) -> Result<Value, String> {
    Err("the embedded browser is only available on macOS".into())
}

fn tool_definitions() -> Vec<Value> {
    let element = json!({
        "type": "object",
        "properties": {
            "ref": { "type": "string", "description": "Element ref from browser_snapshot (preferred)" },
            "selector": { "type": "string", "description": "CSS selector fallback" }
        }
    });
    vec![
        json!({ "name": "browser_status", "description": "Current browser session: open state, tabs and active tab.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_tabs", "description": "List open browser tabs.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_open", "description": "Open the session browser (creates a tab) and optionally navigate to an http(s) URL.", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } } } }),
        json!({ "name": "browser_navigate", "description": "Navigate the active tab to an http(s) URL.", "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] } }),
        json!({ "name": "browser_back", "description": "Go back in the active tab.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_forward", "description": "Go forward in the active tab.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_reload", "description": "Reload the active tab.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_screenshot", "description": "PNG screenshot of the visible page.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_snapshot", "description": "Bounded list of interactive elements with refs (use the refs for click/type).", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "browser_click", "description": "Click an element by ref or selector. Interrupted if the person is using the page.", "inputSchema": element.clone() }),
        json!({ "name": "browser_type", "description": "Type into an element by ref or selector, optional submit.", "inputSchema": { "type": "object", "properties": { "ref": { "type": "string" }, "selector": { "type": "string" }, "text": { "type": "string" }, "submit": { "type": "boolean" } } } }),
        json!({ "name": "browser_scroll", "description": "Scroll the page by dy pixels.", "inputSchema": { "type": "object", "properties": { "dy": { "type": "number" } }, "required": ["dy"] } }),
        json!({ "name": "browser_logs", "description": "Bounded console/error log buffer; optionally clear it.", "inputSchema": { "type": "object", "properties": { "clear": { "type": "boolean" } } } }),
        json!({ "name": "browser_close", "description": "Close all tabs of the session browser.", "inputSchema": { "type": "object", "properties": {} } }),
    ]
    .into_iter()
    .chain(crate::simulator::tool_definitions())
    .collect()
}

/// Child mode: MCP over stdio, tool calls forwarded to the app socket.
pub fn run_stdio() -> i32 {
    crate::mcp_stdio::run(&crate::mcp_stdio::Server {
        name: MCP_SERVER_NAME,
        socket_env: SOCKET_ENV,
        token_env: TOKEN_ENV,
        tools: tool_definitions,
        failure: "the browser operation failed",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_definitions_are_well_formed() {
        let tools = tool_definitions();
        assert!(tools.len() >= 14);
        for tool in &tools {
            assert!(
                tool["name"].as_str().is_some_and(
                    |name| name.starts_with("browser_") || name.starts_with("simulator_")
                )
            );
            assert!(tool["description"]
                .as_str()
                .is_some_and(|text| !text.is_empty()));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }

    #[test]
    fn action_results_map_interruption_and_failures() {
        assert!(action_result("{\"ok\":true}".into()).is_ok());
        assert!(action_result("{\"interrupted\":true}".into()).is_err());
        assert!(action_result("{\"ok\":false,\"error\":\"element not found\"}".into()).is_err());
        assert!(action_result("not json".into()).is_err());
    }

    #[test]
    fn capability_and_reference_validation_is_strict() {
        assert!(constant_time_eq(b"token", b"token"));
        assert!(!constant_time_eq(b"token", b"tokeN"));
        assert!(!constant_time_eq(b"token", b"token "));
        assert!(valid_ref("") && valid_ref("e1") && valid_ref("e123"));
        assert!(!valid_ref("e") && !valid_ref("x1") && !valid_ref("e123456"));
        assert!(valid_selector("button.primary"));
        assert!(!valid_selector("button\n.x"));
    }
}
