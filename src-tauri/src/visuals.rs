//! Inline HTML visuals (ADR-123): `sirus_show_visual` lets an agent publish a chart, a
//! small dashboard or a diagram into its own running reply. The HTML is kept with the
//! message (persisted like the rest of the transcript) and the transcript renders it as a
//! card in the sandboxed `sirus-preview://` frame (`html_preview.rs`, `InlineVisual.tsx`).
//! The tool only ever writes to the calling session's current reply.

use std::sync::Arc;

use crate::runtime::{AppHandle, Manager};
use serde_json::{json, Value};

use crate::commands::AppState;
use crate::models::{MessageRole, MessageVisual, Session};

pub const TOOL: &str = "sirus_show_visual";
/// The HTML of one visual, in bytes.
pub const MAX_HTML_BYTES: usize = 512 * 1024;
pub const MAX_TITLE_CHARS: usize = 120;
/// Distinct visuals one reply may hold (revisions replace in place).
pub const MAX_PER_REPLY: usize = 8;

/// One line appended to Claude's system prompt while the Sirus bridge is attached.
pub const CLAUDE_HINT: &str = "Sirus Code shows visuals in the conversation. When an answer compares options, reports numbers (benchmarks, timings, sizes, costs, before and after), lays out a plan in phases, or explains a flow or an architecture, call the mcp__sirus_browser__sirus_show_visual tool with one compact, themed HTML card instead of a long Markdown table, and keep the reply text to the finding.";

pub fn tool_definition() -> Value {
    json!({
        "name": TOOL,
        "description": "Sirus Code: show a visual inside your reply in the person's conversation: a chart, a small dashboard, a table with highlights, a diagram or a timeline. Use it whenever the answer compares options, reports numbers (benchmarks, timings, sizes, costs, before and after), lays out a plan in phases or explains a flow or an architecture: it reads faster than text and replaces long Markdown tables. Send one self-contained HTML document (inline <style> and <script>, at most 512 KiB). It renders as a card under your reply text, sized to its content (taller pages scroll inside). It runs in an isolated sandbox: no network requests (fetch, XHR and WebSockets are blocked), no forms, popups, dialogs or nested frames, and no storage that survives; https images, fonts, stylesheets and scripts (for example a chart library from a CDN) do load, but prefer inline SVG or canvas. Link clicks open http(s) URLs in the person's browser. The page follows the app theme: use the CSS variables --sirus-text, --sirus-text-secondary, --sirus-muted, --sirus-background, --sirus-surface, --sirus-border, --sirus-accent, --sirus-info, --sirus-success, --sirus-warning, --sirus-danger, --sirus-series-1 to --sirus-series-6 (chart colors), --sirus-font, --sirus-mono, --sirus-font-size and --sirus-radius; html has data-theme light or dark and a sirus-theme event fires on window when it changes (redraw canvas charts then). Leave the page background transparent, let content set the height (no 100vh) and keep it compact (the column is about 700 px wide). Calling it again with the same title in the same turn replaces that visual. Keep your reply text short: state the finding, do not describe the visual. At most 8 visuals per reply.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "A short name shown on the card (at most 120 characters); reuse it to update the visual." },
                "html": { "type": "string", "description": "The complete, self-contained HTML document." }
            },
            "required": ["title", "html"]
        }
    })
}

/// The title on one line, without control characters; the HTML within its size.
pub fn validate(title: &str, html: &str) -> Result<(String, String), String> {
    let title = title
        .split(|c: char| c.is_control() || c.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        return Err("a title is required".into());
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "the title must be at most {MAX_TITLE_CHARS} characters"
        ));
    }
    if html.trim().is_empty() {
        return Err("the html must be a non-empty HTML document".into());
    }
    if html.len() > MAX_HTML_BYTES {
        return Err(format!(
            "the page is {} KiB; the limit is {} KiB: remove embedded data or simplify it",
            html.len().div_ceil(1024),
            MAX_HTML_BYTES / 1024
        ));
    }
    Ok((title, html.to_owned()))
}

/// The reply of the session's current turn: the agent message after its latest user message.
fn current_reply(session: &Session) -> Option<usize> {
    let messages = &session.messages;
    let user = messages
        .iter()
        .rposition(|message| message.role == MessageRole::User)?;
    messages
        .iter()
        .enumerate()
        .skip(user + 1)
        .rev()
        .find(|(_, message)| message.role == MessageRole::Agent)
        .map(|(index, _)| index)
}

/// Adds the visual to the current reply, or replaces the one with the same title.
/// Returns the reply's index and the visual's id and revision.
pub fn publish(
    session: &mut Session,
    title: String,
    html: String,
    now: &str,
) -> Result<(usize, String, u32), String> {
    let index =
        current_reply(session).ok_or("there is no reply in progress to show the visual in")?;
    let reply = &mut session.messages[index];
    if let Some(visual) = reply
        .visuals
        .iter_mut()
        .find(|visual| visual.title == title)
    {
        visual.html = html;
        visual.revision = visual.revision.saturating_add(1);
        visual.created_at = now.to_owned();
        return Ok((index, visual.id.clone(), visual.revision));
    }
    if reply.visuals.len() >= MAX_PER_REPLY {
        return Err(format!(
            "at most {MAX_PER_REPLY} visuals per reply; reuse a title to update one"
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    reply.visuals.push(MessageVisual {
        id: id.clone(),
        title,
        html,
        created_at: now.to_owned(),
        revision: 0,
    });
    Ok((index, id, 0))
}

pub fn execute(app: &AppHandle, session_id: &str, args: &Value) -> Result<Value, String> {
    let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or_default();
    let (title, html) = validate(text("title"), text("html"))?;
    let state = app.state::<Arc<AppState>>().inner().clone();
    let now = chrono::Local::now().to_rfc3339();
    let (snapshot, index, id, revision) = {
        let mut data = state.data_with_messages(&[session_id]);
        let session = data
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or("session not found")?;
        let (index, id, revision) = publish(session, title.clone(), html, &now)?;
        (session.clone(), index, id, revision)
    };
    state.persist().map_err(|error| error.to_string())?;
    crate::transcript_view::emit_from(app, &snapshot, index);
    Ok(json!({
        "shown": true,
        "visualId": id,
        "title": title,
        "updated": revision > 0,
        "hint": "The person sees the visual under your reply; do not describe it again."
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(roles: &[&str]) -> Session {
        let messages: Vec<Value> = roles
            .iter()
            .enumerate()
            .map(|(index, role)| json!({ "id": format!("m{index}"), "sessionId": "s", "role": role, "content": "", "createdAt": "t", "streaming": false }))
            .collect();
        serde_json::from_value(json!({
            "id": "s", "title": "s", "projectId": "p", "agent": "claude", "status": "running",
            "createdAt": "t", "lastActivityAt": "t", "worktree": { "path": "/tmp", "branch": "main", "isolated": false },
            "messages": messages
        }))
        .unwrap()
    }

    #[test]
    fn titles_and_sizes_are_validated() {
        assert_eq!(
            validate("  Build\ntimes \u{7}  ", "<p>x</p>").unwrap().0,
            "Build times"
        );
        assert!(validate(" \n ", "<p>x</p>").is_err());
        assert!(validate(&"t".repeat(MAX_TITLE_CHARS + 1), "<p>x</p>").is_err());
        assert!(validate("Chart", "   ").is_err());
        assert!(validate("Chart", &"x".repeat(MAX_HTML_BYTES)).is_ok());
        let error = validate("Chart", &"x".repeat(MAX_HTML_BYTES + 1)).unwrap_err();
        assert!(error.contains("513 KiB"), "{error}");
    }

    #[test]
    fn visuals_go_to_the_current_reply_and_a_same_title_replaces() {
        let mut session = session(&["user", "agent", "user", "agent"]);
        let (index, id, revision) =
            publish(&mut session, "Chart".into(), "<p>1</p>".into(), "a").unwrap();
        assert_eq!((index, revision), (3, 0));
        let (_, same, revision) =
            publish(&mut session, "Chart".into(), "<p>2</p>".into(), "b").unwrap();
        assert_eq!((same.as_str(), revision), (id.as_str(), 1));
        let reply = &session.messages[3];
        assert_eq!(reply.visuals.len(), 1);
        assert_eq!(reply.visuals[0].html, "<p>2</p>");
        assert!(session.messages[1].visuals.is_empty());
        for index in 1..MAX_PER_REPLY {
            publish(&mut session, format!("Other {index}"), "x".into(), "c").unwrap();
        }
        assert!(publish(&mut session, "One more".into(), "x".into(), "d").is_err());
        // Revisions of an existing visual still go through at the bound.
        assert!(publish(&mut session, "Chart".into(), "<p>3</p>".into(), "e").is_ok());
    }

    #[test]
    fn a_turn_without_its_reply_refuses() {
        assert!(publish(
            &mut session(&["user", "agent", "user"]),
            "C".into(),
            "x".into(),
            "t"
        )
        .is_err());
        assert!(publish(&mut session(&[]), "C".into(), "x".into(), "t").is_err());
    }

    #[test]
    fn messages_round_trip_their_visuals_and_old_ones_load_without() {
        let mut session = session(&["user", "agent"]);
        publish(&mut session, "Chart".into(), "<svg/>".into(), "t").unwrap();
        let encoded = serde_json::to_value(&session.messages[1]).unwrap();
        assert_eq!(encoded["visuals"][0]["title"], "Chart");
        assert_eq!(encoded["visuals"][0]["createdAt"], "t");
        let decoded: crate::models::Message = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded.visuals, session.messages[1].visuals);
        // Rows written before visuals existed, and replies without any, carry no field.
        assert!(serde_json::to_value(&session.messages[0])
            .unwrap()
            .get("visuals")
            .is_none());
        let old: crate::models::Message = serde_json::from_value(json!({ "id": "m", "sessionId": "s", "role": "agent", "content": "hi", "createdAt": "t", "streaming": false })).unwrap();
        assert!(old.visuals.is_empty());
        let no_revision: MessageVisual = serde_json::from_value(
            json!({ "id": "v", "title": "T", "html": "<p/>", "createdAt": "t" }),
        )
        .unwrap();
        assert_eq!(no_revision.revision, 0);
    }
}
