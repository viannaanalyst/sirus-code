//! Large command output stored apart (ADR-147). A settled command row whose output is longer
//! than [`APART_BYTES`] is saved with only its last lines in the message row (`output`) and
//! its size (`outputBytes`); the full text goes to the `tool_outputs` table (`store.rs`) in
//! the same transaction, keyed by session, message and row id. Transcripts then load without
//! it, and the renderer fetches it through `transcript_action { toolOutput }` when the person
//! opens the row. A running row's output stays in the message as before.
use std::borrow::Cow;
use std::path::Path;

use serde_json::Value;

use crate::activity::{ActivityItem, ItemState};
use crate::models::{Message, MessageRole, Session};

/// Output longer than this (bytes) is stored apart. Command output is already at most the
/// last 60 lines and 3,000 characters, so 4 KiB would move almost nothing; most of the bytes
/// are outputs between 1 and 3 KB.
pub const APART_BYTES: usize = 1024;
/// The preview kept in the message: the last lines (where a command's result and errors are),
/// at most this many…
const PREVIEW_LINES: usize = 6;
/// …and this many bytes.
const PREVIEW_BYTES: usize = 480;
/// Largest output returned to the renderer (stored outputs are far smaller).
pub const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
/// Longest id accepted in a request.
const MAX_ID: usize = 256;

/// One output moved out of a message: the row id and its full text.
pub type Moved = (String, String);

fn moves(state: &ItemState, output: &str, apart: bool) -> bool {
    !apart && *state != ItemState::Running && output.len() > APART_BYTES
}

fn item_moves(item: &ActivityItem) -> bool {
    moves(&item.state, &item.output, item.output_bytes.is_some())
}

/// The last lines of `text`, at most [`PREVIEW_LINES`] lines and [`PREVIEW_BYTES`] bytes.
pub fn preview(text: &str) -> String {
    let text = text.trim_end();
    let lines = text
        .rmatch_indices('\n')
        .nth(PREVIEW_LINES - 1)
        .map_or(0, |(index, _)| index + 1);
    let mut start = lines.max(text.len().saturating_sub(PREVIEW_BYTES));
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_owned()
}

/// The message as it is stored: settled command rows with large output keep a preview and
/// their size, and the full outputs are returned to be written beside it. Borrowed when
/// nothing moves.
pub fn split(message: &Message) -> (Cow<'_, Message>, Vec<Moved>) {
    let large = message
        .activity
        .as_ref()
        .is_some_and(|activity| activity.items.iter().any(item_moves));
    if !large {
        return (Cow::Borrowed(message), Vec::new());
    }
    let mut stored = message.clone();
    let mut moved = Vec::new();
    for item in stored
        .activity
        .iter_mut()
        .flat_map(|activity| activity.items.iter_mut())
    {
        if item_moves(item) {
            let full = std::mem::take(&mut item.output);
            item.output = preview(&full);
            item.output_bytes = Some(u32::try_from(full.len()).unwrap_or(u32::MAX));
            moved.push((item.id.clone(), full));
        }
    }
    (Cow::Owned(stored), moved)
}

/// Row ids whose output is stored apart in a stored message.
pub fn apart_ids(message: &Message) -> Vec<String> {
    message
        .activity
        .iter()
        .flat_map(|activity| &activity.items)
        .filter(|item| item.output_bytes.is_some())
        .map(|item| item.id.clone())
        .collect()
}

/// [`split`] on a stored row's JSON, for rows written before ADR-147 (the one-time
/// migration). Only the moved rows change; every other field is left as written.
pub fn split_value(message: &mut Value) -> Vec<Moved> {
    let mut moved = Vec::new();
    let Some(items) = message
        .pointer_mut("/activity/items")
        .and_then(Value::as_array_mut)
    else {
        return moved;
    };
    for item in items.iter_mut().filter_map(Value::as_object_mut) {
        let state = item
            .get("state")
            .cloned()
            .and_then(|state| serde_json::from_value::<ItemState>(state).ok())
            .unwrap_or(ItemState::Unknown);
        let (Some(id), Some(output)) = (
            item.get("id").and_then(Value::as_str),
            item.get("output").and_then(Value::as_str),
        ) else {
            continue;
        };
        if !moves(&state, output, item.contains_key("outputBytes")) {
            continue;
        }
        let (id, full) = (id.to_owned(), output.to_owned());
        item.insert("output".into(), Value::String(preview(&full)));
        item.insert(
            "outputBytes".into(),
            full.len().min(u32::MAX as usize).into(),
        );
        moved.push((id, full));
    }
    moved
}

/// Puts the stored full outputs back into a fork's copied messages, which have new ids: the
/// copy saves them again under its own (ADR-147). The fork copies the source's non-system
/// messages from the start, in order. Rows whose output cannot be read keep their preview.
pub fn restore_fork(state_path: &Path, source: &Session, fork: &mut [Message]) {
    if !crate::persist::uses_database(state_path) {
        return;
    }
    let originals = source
        .messages
        .iter()
        .filter(|message| message.role != MessageRole::System);
    for (copy, original) in fork.iter_mut().zip(originals) {
        if apart_ids(copy).is_empty() {
            continue;
        }
        let Ok(stored) = crate::store::read_tool_outputs(state_path, &source.id, &original.id)
        else {
            continue;
        };
        restore(copy, &stored);
    }
}

/// Sets each row's full output from `stored` (`(row id, text)`); the row is whole again.
fn restore(message: &mut Message, stored: &[(String, String)]) {
    for item in message
        .activity
        .iter_mut()
        .flat_map(|activity| activity.items.iter_mut())
        .filter(|item| item.output_bytes.is_some())
    {
        if let Some((_, text)) = stored.iter().find(|(id, _)| *id == item.id) {
            item.output.clone_from(text);
            item.output_bytes = None;
        }
    }
}

/// Where a requested output is: already in memory, or to read from the store.
pub enum Located {
    Here(String),
    Stored,
}

/// Finds a row's output in a loaded transcript; an unloaded one reads from the store.
pub fn locate(messages: Option<&[Message]>, message_id: &str, step_id: &str) -> Option<Located> {
    let Some(messages) = messages else {
        return Some(Located::Stored);
    };
    let item = messages
        .iter()
        .find(|message| message.id == message_id)?
        .activity
        .as_ref()?
        .items
        .iter()
        .find(|item| item.id == step_id)?;
    Some(if item.output_bytes.is_some() {
        Located::Stored
    } else {
        Located::Here(item.output.clone())
    })
}

/// Request ids are bounded and plain.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && !id.chars().any(char::is_control)
}

/// The end of `text` within [`MAX_OUTPUT_BYTES`], on a character boundary.
pub fn bounded(mut text: String) -> String {
    if text.len() <= MAX_OUTPUT_BYTES {
        return text;
    }
    let mut start = text.len() - MAX_OUTPUT_BYTES;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text.drain(..start);
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(items: Value) -> Message {
        serde_json::from_value(json!({
            "id": "m1", "sessionId": "s1", "role": "agent", "content": "done",
            "createdAt": "2026-10-19T00:00:00Z", "streaming": false,
            "activity": {
                "provider": "codex", "model": null, "startedAt": 1, "endedAt": 2,
                "waitingSince": null, "pausedMs": 0, "status": "idle", "items": items,
                "truncated": false
            }
        }))
        .unwrap()
    }

    fn output(lines: usize) -> String {
        (0..lines)
            .map(|line| format!("line {line} of the build output"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_preview_is_the_last_lines_within_its_bounds() {
        assert_eq!(preview("one\ntwo\n"), "one\ntwo");
        let long = output(100);
        let shown = preview(&long);
        assert!(shown.len() <= PREVIEW_BYTES);
        assert_eq!(shown.lines().count(), PREVIEW_LINES);
        assert!(long.ends_with(&shown));
        assert!(shown.starts_with("line 94"));
        // One very long line keeps its end, on a character boundary.
        let wide = "é".repeat(2000);
        let shown = preview(&wide);
        assert!(shown.len() <= PREVIEW_BYTES && wide.ends_with(&shown));
    }

    #[test]
    fn only_settled_large_outputs_move() {
        let long = output(80);
        assert!(long.len() > APART_BYTES);
        let small = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": "ok"}
        ]));
        assert!(matches!(split(&small), (Cow::Borrowed(_), moved) if moved.is_empty()));
        let running = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "running", "model": null, "output": long}
        ]));
        assert!(matches!(split(&running), (Cow::Borrowed(_), moved) if moved.is_empty()));
        let done = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": long},
            {"id": "c2", "kind": "command", "label": "Command", "state": "failed", "model": null, "output": "short"}
        ]));
        let (stored, moved) = split(&done);
        assert_eq!(moved, vec![("c1".to_owned(), long.clone())]);
        let items = &stored.activity.as_ref().unwrap().items;
        assert_eq!(items[0].output, preview(&long));
        assert_eq!(items[0].output_bytes, Some(long.len() as u32));
        assert_eq!(items[1].output, "short");
        assert_eq!(apart_ids(&stored), vec!["c1".to_owned()]);
        // A stored message moves nothing again.
        assert!(split(&stored).1.is_empty());
    }

    #[test]
    fn the_migration_split_matches_the_save_split() {
        let long = output(80);
        let done = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": long},
            {"id": "c2", "kind": "command", "label": "Command", "state": "running", "model": null, "output": long}
        ]));
        let mut row = serde_json::to_value(&done).unwrap();
        let moved = split_value(&mut row);
        let (stored, expected) = split(&done);
        assert_eq!(moved, expected);
        assert_eq!(row, serde_json::to_value(stored.as_ref()).unwrap());
        assert!(split_value(&mut row).is_empty());
    }

    #[test]
    fn a_loaded_transcript_points_at_memory_or_the_store() {
        let long = output(80);
        let full = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": long}
        ]));
        let (stored, _) = split(&full);
        let loaded = [full.clone()];
        assert!(
            matches!(locate(Some(&loaded), "m1", "c1"), Some(Located::Here(text)) if text == long)
        );
        let light = [stored.into_owned()];
        assert!(matches!(
            locate(Some(&light), "m1", "c1"),
            Some(Located::Stored)
        ));
        assert!(locate(Some(&light), "m1", "nope").is_none());
        assert!(matches!(locate(None, "m1", "c1"), Some(Located::Stored)));
    }

    #[test]
    fn a_restored_row_is_whole_again() {
        let long = output(80);
        let full = message(json!([
            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": long}
        ]));
        let (stored, moved) = split(&full);
        let mut copy = stored.into_owned();
        restore(&mut copy, &moved);
        assert_eq!(
            serde_json::to_value(&copy).unwrap(),
            serde_json::to_value(&full).unwrap()
        );
    }

    #[test]
    fn requests_and_answers_are_bounded() {
        assert!(
            valid_id("c1") && !valid_id("") && !valid_id(&"x".repeat(300)) && !valid_id("a\nb")
        );
        let huge = "é".repeat(MAX_OUTPUT_BYTES);
        let kept = bounded(huge.clone());
        assert!(kept.len() <= MAX_OUTPUT_BYTES && huge.ends_with(&kept));
        assert_eq!(bounded("ok".into()), "ok");
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use crate::models::{AppData, Session};
    use serde_json::json;
    use std::path::PathBuf;

    fn long(seed: &str) -> String {
        (0..80)
            .map(|line| format!("{seed} line {line} of the test run"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn session(id: &str, outputs: &[&str]) -> Session {
        let messages: Vec<Value> = outputs
            .iter()
            .enumerate()
            .map(|(index, output)| {
                json!({
                    "id": format!("{id}-{index}"), "sessionId": id, "role": "agent", "content": "done",
                    "createdAt": "t", "streaming": false,
                    "activity": {
                        "provider": "codex", "model": null, "startedAt": 1, "endedAt": 2,
                        "waitingSince": null, "pausedMs": 0, "status": "completed", "truncated": false,
                        "items": [
                            {"id": "c1", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": output},
                            {"id": "c2", "kind": "command", "label": "Command", "state": "completed", "model": null, "output": "ok"}
                        ]
                    }
                })
            })
            .collect();
        serde_json::from_value(json!({"id":id,"title":"Task","projectId":"p","agent":"codex","status":"completed","createdAt":"t","lastActivityAt":"t","worktree":{"path":"/fixture","branch":"main","isolated":false},"lastError":null,"messages":messages})).unwrap()
    }

    fn data(sessions: Vec<Session>) -> AppData {
        AppData {
            projects: vec![serde_json::from_value(
                json!({"id":"p","name":"P","path":"/fixture","addedAt":"t","lastOpenedAt":"t"}),
            )
            .unwrap()],
            sessions,
            ..AppData::default()
        }
    }

    fn setup() -> (crate::git::tests::Repo, PathBuf) {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        crate::persist::load_or_create(&path).unwrap();
        (temp, path)
    }

    fn row(path: &Path, session_id: &str, position: i64) -> String {
        crate::store::raw(path)
            .query_row(
                "SELECT json FROM messages WHERE session_id = ?1 AND position = ?2",
                rusqlite::params![session_id, position],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn outputs(path: &Path, session_id: &str) -> i64 {
        crate::store::raw(path)
            .query_row(
                "SELECT COUNT(*) FROM tool_outputs WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn reload(path: &Path, session_id: &str) -> Vec<Message> {
        crate::store::forget(path);
        let origin = crate::transcript_store::Origin::new(path, session_id);
        crate::persist::read_origin(&origin).unwrap().messages
    }

    #[test]
    fn large_output_is_stored_apart_loaded_light_and_fetched_whole() {
        let (_temp, path) = setup();
        let full = long("build");
        let state = data(vec![session("a", &[&full])]);
        crate::persist::save(&path, &state).unwrap();
        let stored = row(&path, "a", 0);
        assert!(!stored.contains(&full) && stored.contains("\"outputBytes\""));
        assert!(stored.contains("\"output\":\"ok\""), "small output stays");
        assert_eq!(outputs(&path, "a"), 1);

        let light = reload(&path, "a");
        let item = &light[0].activity.as_ref().unwrap().items[0];
        assert_eq!(item.output, preview(&full));
        assert_eq!(item.output_bytes, Some(full.len() as u32));
        assert_eq!(
            crate::store::read_tool_output(&path, "a", "a-0", "c1").unwrap(),
            Some(full.clone())
        );
        assert_eq!(
            crate::store::read_tool_output(&path, "a", "a-0", "c2").unwrap(),
            None
        );

        // Saving the light transcript again (with a change) keeps the stored output.
        let mut state = data(vec![session("a", &[&full])]);
        state.sessions[0].messages.install(light);
        state.sessions[0].messages[0].content.push_str(" again");
        crate::persist::save(&path, &state).unwrap();
        assert!(row(&path, "a", 0).contains(" again"));
        assert_eq!(outputs(&path, "a"), 1);

        // The request reads it from the store, or from memory while it is whole.
        let shared = parking_lot::Mutex::new(state);
        let fetch = |shared: &parking_lot::Mutex<AppData>, step: &str| {
            match crate::transcript_view::tool_output(shared, &path, "a", "a-0", step) {
                Ok(crate::transcript_view::Response::ToolOutput { text }) => Ok(text),
                Ok(_) => panic!("unexpected response"),
                Err(error) => Err(error),
            }
        };
        assert_eq!(fetch(&shared, "c1").unwrap(), full);
        assert_eq!(fetch(&shared, "c2").unwrap(), "ok");
        assert!(fetch(&shared, "missing").is_err());
        assert!(fetch(&shared, "").is_err());
        let whole = parking_lot::Mutex::new(data(vec![session("a", &[&full])]));
        assert_eq!(fetch(&whole, "c1").unwrap(), full);
    }

    #[test]
    fn removed_messages_and_sessions_take_their_outputs_with_them() {
        let (_temp, path) = setup();
        let (one, two) = (long("one"), long("two"));
        let mut state = data(vec![session("a", &[&one, &two]), session("b", &[&one])]);
        crate::persist::save(&path, &state).unwrap();
        assert_eq!((outputs(&path, "a"), outputs(&path, "b")), (2, 1));
        state.sessions[0].messages.truncate(1);
        crate::persist::save(&path, &state).unwrap();
        assert_eq!(outputs(&path, "a"), 1);
        assert_eq!(
            crate::store::read_tool_output(&path, "a", "a-1", "c1").unwrap(),
            None
        );
        state.sessions.remove(1);
        crate::persist::save(&path, &state).unwrap();
        assert_eq!(outputs(&path, "b"), 0);
        // A row whose output became small again (a rewritten message) drops it.
        state.sessions[0].messages[0]
            .activity
            .as_mut()
            .unwrap()
            .items[0]
            .output = "short".into();
        crate::persist::save(&path, &state).unwrap();
        assert_eq!(outputs(&path, "a"), 0);
    }

    #[test]
    fn rows_saved_before_are_split_once_when_the_database_opens() {
        let (_temp, path) = setup();
        let full = long("old");
        crate::persist::save(&path, &data(vec![session("a", &[&full])])).unwrap();
        // As a version before ADR-147 wrote it: the whole output in the row.
        let before = {
            let message = session("a", &[&full]).messages[0].clone();
            crate::activity::persisting(|| serde_json::to_string(&message)).unwrap()
        };
        crate::store::forget(&path);
        let raw = crate::store::raw(&path);
        raw.execute_batch(
            "DROP TABLE tool_outputs; DELETE FROM schema_migrations WHERE version = 6;",
        )
        .unwrap();
        raw.execute(
            "UPDATE messages SET json = ?1 WHERE session_id = 'a'",
            [&before],
        )
        .unwrap();
        drop(raw);
        crate::store::open(&path).unwrap();
        let stored = row(&path, "a", 0);
        assert!(!stored.contains(&full) && stored.contains("\"outputBytes\""));
        assert_eq!(
            crate::store::read_tool_output(&path, "a", "a-0", "c1").unwrap(),
            Some(full)
        );
        // It ran once.
        crate::store::forget(&path);
        crate::store::open(&path).unwrap();
        assert_eq!(outputs(&path, "a"), 1);
    }

    #[test]
    fn a_fork_carries_the_outputs_stored_apart() {
        let (_temp, path) = setup();
        let full = long("fork");
        crate::persist::save(&path, &data(vec![session("a", &[&full])])).unwrap();
        let mut source = session("a", &[&full]);
        source.messages.install(reload(&path, "a"));
        let mut copy: Vec<Message> = source.messages.to_vec();
        copy[0].id = "copy".into();
        restore_fork(&path, &source, &mut copy);
        let item = &copy[0].activity.as_ref().unwrap().items[0];
        assert_eq!(
            (item.output.as_str(), item.output_bytes),
            (full.as_str(), None)
        );
    }
}

/// Load time and size of the largest session before and after ADR-147, on a copy of a real
/// database (prints numbers only). Run by hand:
/// `SIRUS_MEASURE_DB=/tmp/copy/state.db cargo test --lib tool_output::measure -- --ignored --nocapture`
#[cfg(test)]
mod measure {
    use super::*;
    use std::time::Instant;

    fn median(mut runs: Vec<f64>) -> f64 {
        runs.sort_by(f64::total_cmp);
        runs[runs.len() / 2]
    }

    fn held(messages: &[Message]) -> (usize, usize) {
        let json = crate::activity::persisting(|| serde_json::to_string(messages))
            .unwrap()
            .len();
        let outputs = messages
            .iter()
            .flat_map(|message| message.activity.iter().flat_map(|a| &a.items))
            .map(|item| item.output.len())
            .sum();
        (json, outputs)
    }

    #[test]
    #[ignore]
    fn measure_owner_database() {
        let Ok(source) = std::env::var("SIRUS_MEASURE_DB") else {
            return;
        };
        let temp = crate::git::tests::Repo::new();
        let (before_dir, after_dir) = (temp.0.join("before"), temp.0.join("after"));
        for dir in [&before_dir, &after_dir] {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::copy(&source, dir.join("state.db")).unwrap();
        }
        let raw = rusqlite::Connection::open(before_dir.join("state.db")).unwrap();
        let (session, rows, bytes): (String, i64, i64) = raw
            .query_row(
                "SELECT session_id, COUNT(*), SUM(length(json)) FROM messages GROUP BY session_id ORDER BY 3 DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let total: i64 = raw
            .query_row("SELECT SUM(length(json)) FROM messages", [], |row| {
                row.get(0)
            })
            .unwrap();
        println!("largest session: {rows} messages, {bytes} B of rows; all messages {total} B");
        // Before: every row parsed whole, as the earlier read did.
        let read_before = || {
            let mut statement = raw
                .prepare("SELECT json FROM messages WHERE session_id = ?1 ORDER BY position")
                .unwrap();
            statement
                .query_map([&session], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|json| serde_json::from_str::<Message>(&json.unwrap()).unwrap())
                .collect::<Vec<_>>()
        };
        let runs = (0..7)
            .map(|_| {
                let start = Instant::now();
                std::hint::black_box(read_before());
                start.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        let (json, outputs) = held(&read_before());
        println!(
            "before: load {:.2} ms, transcript {json} B as JSON, {outputs} B of command output",
            median(runs)
        );
        let size = |dir: &Path| std::fs::metadata(dir.join("state.db")).unwrap().len();
        let file_before = size(&after_dir);
        // After: the migration splits the copy once, then loads read the light rows.
        let state_path = after_dir.join("state.json");
        let start = Instant::now();
        crate::store::open(&state_path).unwrap();
        println!(
            "migration: {:.1} ms",
            start.elapsed().as_secs_f64() * 1000.0
        );
        let runs = (0..7)
            .map(|_| {
                let start = Instant::now();
                std::hint::black_box(crate::store::read_messages(&state_path, &session).unwrap());
                start.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        let (json, outputs) = held(&crate::store::read_messages(&state_path, &session).unwrap());
        println!(
            "after: load {:.2} ms, transcript {json} B as JSON, {outputs} B of command output",
            median(runs)
        );
        let after = rusqlite::Connection::open(after_dir.join("state.db")).unwrap();
        let (moved, moved_bytes): (i64, i64) = after
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM tool_outputs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let total_after: i64 = after
            .query_row("SELECT SUM(length(json)) FROM messages", [], |row| {
                row.get(0)
            })
            .unwrap();
        println!(
            "all messages {total} B -> {total_after} B; {moved} outputs ({moved_bytes} B) stored apart; file {file_before} B -> {} B",
            size(&after_dir)
        );
    }
}
