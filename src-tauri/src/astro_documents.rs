//! Astro documents (ADR-088): Markdown reports and plans an Astro writes with its tools.
//! Each document is one JSON file under `documents/` next to `state.json`, so long
//! documents never weigh on every state save. Replies list the documents written or
//! revised during their turn; the reader opens them from there.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::models::MessageRole;
use crate::paths::now_rfc3339;

/// Sent with the document id whenever one is written or deleted, so open readers refresh.
pub const CHANGED: &str = "astro-document-changed";
const TITLE_LIMIT: usize = 120;
const MARKDOWN_LIMIT: usize = 100_000;
const MAX_PER_ASTRO: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub astro_id: String,
    pub title: String,
    pub markdown: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    Read {
        id: String,
    },
    /// Removes the document and its cards from every reply.
    Delete {
        id: String,
        confirm: bool,
    },
}

#[tauri::command]
pub async fn astro_document_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Value> {
    let state = state.inner().clone();
    native_task(move || match action {
        Action::Read { id } => Ok(json!(read(&dir(&state), &id)?)),
        Action::Delete { confirm: false, .. } => Err(Error::confirmation_required(
            "Deleting a document needs confirmation.",
        )),
        Action::Delete { id, .. } => {
            delete(&app, &state, &id)?;
            Ok(json!({ "deleted": true }))
        }
    })
    .await
}

fn dir(state: &AppState) -> PathBuf {
    state
        .data_path
        .parent()
        .map(|parent| parent.join("documents"))
        .unwrap_or_else(|| PathBuf::from("documents"))
}

/// Ids are UUIDs the app made; anything else could escape the folder.
fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok()
}

fn path(dir: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(Error::not_found("document not found"));
    }
    Ok(dir.join(format!("{id}.json")))
}

fn read(dir: &Path, id: &str) -> Result<Document> {
    let bytes =
        std::fs::read(path(dir, id)?).map_err(|_| Error::not_found("document not found"))?;
    serde_json::from_slice(&bytes).map_err(|_| Error::not_found("document not found"))
}

fn list(dir: &Path, astro_id: &str) -> Vec<Document> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut documents: Vec<Document> = entries
        .flatten()
        .filter_map(|entry| std::fs::read(entry.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<Document>(&bytes).ok())
        .filter(|document| document.astro_id == astro_id)
        .collect();
    documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    documents
}

fn write_file(dir: &Path, document: &Document) -> Result<()> {
    let failed = |_| Error::new("io", "Could not save the document.");
    std::fs::create_dir_all(dir).map_err(failed)?;
    let target = path(dir, &document.id)?;
    let temporary = target.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(document)
        .map_err(|_| Error::new("io", "Could not save the document."))?;
    std::fs::write(&temporary, bytes).map_err(failed)?;
    std::fs::rename(&temporary, &target).map_err(failed)?;
    Ok(())
}

fn delete(app: &AppHandle, state: &AppState, id: &str) -> Result<()> {
    let target = path(&dir(state), id)?;
    if !target.exists() {
        return Err(Error::not_found("document not found"));
    }
    std::fs::remove_file(&target)
        .map_err(|_| Error::new("io", "Could not delete the document."))?;
    // Its cards leave every reply, so a later save cannot bring them back. Only
    // transcripts that mention it are loaded (read without the lock, ADR-099).
    let mentioning = crate::transcript_store::sessions_mentioning(&state.data, id);
    let changed: Vec<(crate::models::Session, usize)> = {
        let mut data =
            state.data_with_messages(&mentioning.iter().map(String::as_str).collect::<Vec<_>>());
        data.sessions
            .iter_mut()
            .filter(|session| mentioning.contains(&session.id))
            .filter_map(|session| {
                let first = session
                    .messages
                    .iter()
                    .position(|message| message.documents.iter().any(|item| item == id))?;
                for message in &mut session.messages {
                    message.documents.retain(|item| item != id);
                }
                Some((session.clone(), first))
            })
            .collect()
    };
    state.persist()?;
    for (session, from) in changed {
        crate::transcript_view::emit_from(app, &session, from);
    }
    let _ = app.emit(CHANGED, json!({ "id": id }));
    Ok(())
}

/// Removes every document of a deleted Astro.
pub fn forget_astro(state: &AppState, astro_id: &str) {
    let dir = dir(state);
    for document in list(&dir, astro_id) {
        if let Ok(target) = path(&dir, &document.id) {
            let _ = std::fs::remove_file(target);
        }
    }
}

fn clean_title(title: &str) -> std::result::Result<String, String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() || title.chars().count() > TITLE_LIMIT {
        return Err("a title of 1 to 120 characters is required".into());
    }
    Ok(title)
}

/// The caller's reply in progress: the last agent message of its conversation.
fn reply_documents(state: &AppState, session_id: &str) -> Vec<String> {
    state
        .data_with_messages(&[session_id])
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .and_then(|session| {
            session
                .messages
                .iter()
                .rev()
                .find(|message| message.role == MessageRole::Agent)
        })
        .map(|message| message.documents.clone())
        .unwrap_or_default()
}

fn attach(app: &AppHandle, state: &AppState, session_id: &str, id: &str) {
    let snapshot = {
        let mut data = state.data_with_messages(&[session_id]);
        let Some(session) = data.sessions.iter_mut().find(|item| item.id == session_id) else {
            return;
        };
        let Some(index) = session
            .messages
            .iter()
            .rposition(|message| message.role == MessageRole::Agent)
        else {
            return;
        };
        let reply = &mut session.messages[index];
        if reply.documents.iter().any(|item| item == id) || reply.documents.len() >= 20 {
            return;
        }
        reply.documents.push(id.to_string());
        (session.clone(), index)
    };
    let _ = state.persist();
    crate::transcript_view::emit_from(app, &snapshot.0, snapshot.1);
}

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({ "name": "astro_documents_list", "description": "Astro conversations only: your saved documents (id, title, last update), newest first.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "astro_document_read", "description": "Astro conversations only: a saved document's full Markdown.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } }),
        json!({ "name": "astro_document_write", "description": "Astro conversations only: save a report, plan or other deliverable as a lasting Markdown document, shown as a card under your reply. Pass `id` to revise an existing document; without it a new one is created (a retry with the same title in the same reply revises it instead of duplicating).", "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "Existing document to revise." }, "title": { "type": "string" }, "markdown": { "type": "string", "description": "The complete document." } }, "required": ["title", "markdown"] } }),
    ]
}

/// One `astro_document*` tool call from an Astro conversation or habit run.
pub fn execute(
    app: &AppHandle,
    session_id: &str,
    astro_id: &str,
    tool: &str,
    args: &Value,
) -> std::result::Result<Value, String> {
    let state = app.state::<Arc<AppState>>().inner().clone();
    let dir = dir(&state);
    let arg = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let owned = |id: &str| {
        read(&dir, id.trim())
            .ok()
            .filter(|document| document.astro_id == astro_id)
            .ok_or_else(|| "no document with that id".to_string())
    };
    match tool {
        "astro_documents_list" => {
            let rows: Vec<Value> = list(&dir, astro_id)
                .into_iter()
                .take(100)
                .map(|document| json!({ "id": document.id, "title": document.title, "updatedAt": document.updated_at }))
                .collect();
            Ok(json!({ "documents": rows }))
        }
        "astro_document_read" => {
            let document = owned(&arg("id"))?;
            Ok(
                json!({ "id": document.id, "title": document.title, "markdown": document.markdown, "updatedAt": document.updated_at }),
            )
        }
        "astro_document_write" => {
            let title = clean_title(&arg("title"))?;
            let markdown = arg("markdown");
            if markdown.trim().is_empty() || markdown.chars().count() > MARKDOWN_LIMIT {
                return Err("markdown of up to 100,000 characters is required".into());
            }
            let now = now_rfc3339();
            let wanted = arg("id");
            let existing = if wanted.trim().is_empty() {
                // A retried creation in the same reply revises what it already saved.
                reply_documents(&state, session_id)
                    .iter()
                    .filter_map(|id| owned(id).ok())
                    .find(|document| document.title == title)
            } else {
                Some(owned(&wanted)?)
            };
            let created = existing.is_none();
            let document = match existing {
                Some(document) => Document {
                    title,
                    markdown,
                    updated_at: now,
                    ..document
                },
                None => {
                    if list(&dir, astro_id).len() >= MAX_PER_ASTRO {
                        return Err(
                            "you have 200 documents; revise or ask the person to delete some"
                                .into(),
                        );
                    }
                    Document {
                        id: Uuid::new_v4().to_string(),
                        astro_id: astro_id.to_string(),
                        title,
                        markdown,
                        created_at: now.clone(),
                        updated_at: now,
                    }
                }
            };
            write_file(&dir, &document).map_err(|error| error.to_string())?;
            attach(app, &state, session_id, &document.id);
            let _ = app.emit(CHANGED, json!({ "id": document.id }));
            Ok(json!({ "id": document.id, "created": created, "title": document.title }))
        }
        _ => Err("unknown document tool".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(id: &str, astro: &str, updated: &str) -> Document {
        Document {
            id: id.into(),
            astro_id: astro.into(),
            title: "Plano".into(),
            markdown: "# Plano".into(),
            created_at: updated.into(),
            updated_at: updated.into(),
        }
    }

    #[test]
    fn documents_stay_inside_their_folder_and_astro() {
        let dir = std::env::temp_dir().join(format!("sirus-docs-{}", Uuid::new_v4()));
        let first = Uuid::new_v4().to_string();
        let second = Uuid::new_v4().to_string();
        write_file(&dir, &document(&first, "a", "2026-01-01T00:00:00Z")).unwrap();
        write_file(&dir, &document(&second, "a", "2026-02-01T00:00:00Z")).unwrap();
        write_file(
            &dir,
            &document(&Uuid::new_v4().to_string(), "b", "2026-03-01T00:00:00Z"),
        )
        .unwrap();
        let listed: Vec<String> = list(&dir, "a").into_iter().map(|item| item.id).collect();
        assert_eq!(listed, vec![second, first.clone()]);
        assert_eq!(read(&dir, &first).unwrap().astro_id, "a");
        assert!(read(&dir, "../state").is_err());
        assert!(path(&dir, "x/../../y").is_err());
        assert!(clean_title("  Relatório   semanal ").unwrap() == "Relatório semanal");
        assert!(clean_title("").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
