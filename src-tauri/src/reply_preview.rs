//! What a conversation said last, for the sidebar's hover card (ADR-139): the last
//! paragraph of its newest assistant reply that has words, as plain text (Markdown
//! dropped, code blocks skipped), credentials masked (ADR-077) and at most
//! [`MAX_CHARS`] characters. It is kept beside a transcript's counts, so the list
//! never reads an unloaded transcript for it. Mirrors `replySnippet` in
//! `src/lib/conversation-hover.ts`.

use std::sync::LazyLock;

use regex::Regex;

use crate::models::{Message, MessageRole};

/// Longest preview, in characters (three lines of the card need about half of it).
pub const MAX_CHARS: usize = 280;
/// Only the end of a reply is read for its last paragraph.
const WINDOW: usize = 4096;

/// A line that is only a horizontal rule or a table's separator row.
static RULE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?)$")
        .unwrap()
});
/// Quote, heading, list and task markers at the start of a line.
static BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?").unwrap()
});
static IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").unwrap());
static LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]+)\](?:\([^)]*\)|\[[^\]]*\])").unwrap());
static AUTOLINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<((?:https?|mailto):[^>\s]+)>").unwrap());
static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?>").unwrap());
static STRONG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^|[^\w])(\*\*|__|~~)(\S(?:.*?\S)?)(?:\*\*|__|~~)").unwrap());
static EMPHASIS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^|[^\w*_])[*_]([^*_\s](?:[^*_]*[^*_\s])?)[*_]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

/// The preview of the newest assistant reply with words; an earlier one when the
/// newest has none yet (a turn that only started, or only ran tools).
pub fn of(messages: &[Message]) -> Option<String> {
    messages
        .iter()
        .rev()
        .filter(|message| message.role == MessageRole::Agent)
        .find_map(|message| excerpt(&message.content))
}

fn is_fence(line: &str) -> bool {
    let line = line.trim_start();
    line.starts_with("```") || line.starts_with("~~~")
}

/// One line of Markdown as plain text; empty when nothing readable is left.
fn plain_line(line: &str) -> String {
    let line = line.trim();
    if RULE.is_match(line) {
        return String::new();
    }
    let line = BLOCK.replace(line, "");
    let line = IMAGE.replace_all(&line, "$1");
    let line = LINK.replace_all(&line, "$1");
    let line = AUTOLINK.replace_all(&line, "$1");
    let line = TAG.replace_all(&line, "");
    let line = line.replace('`', "");
    let line = STRONG.replace_all(&line, "${1}${3}");
    let line = EMPHASIS.replace_all(&line, "${1}${2}");
    let line = if line.trim_start().starts_with('|') {
        line.replace('|', " ")
    } else {
        line.into_owned()
    };
    SPACES.replace_all(line.trim(), " ").into_owned()
}

/// The last paragraph of `content` with words, as a bounded, masked plain text.
pub fn excerpt(content: &str) -> Option<String> {
    let mut start = content.len().saturating_sub(WINDOW);
    while !content.is_char_boundary(start) {
        start += 1;
    }
    let mut in_fence = false;
    if start > 0 {
        // The cut line is dropped; whether the window starts inside a code block
        // depends on the fences before it.
        start = content[start..]
            .find('\n')
            .map_or(content.len(), |at| start + at + 1);
        in_fence = content[..start]
            .lines()
            .filter(|line| is_fence(line))
            .count()
            % 2
            == 1;
    }
    let mut paragraph: Vec<String> = Vec::new();
    let mut last: Vec<String> = Vec::new();
    for line in content[start..].lines() {
        let fence = is_fence(line);
        in_fence ^= fence;
        let plain = if fence || in_fence {
            String::new()
        } else {
            plain_line(line)
        };
        if plain.is_empty() {
            if !paragraph.is_empty() {
                last = std::mem::take(&mut paragraph);
            }
        } else {
            paragraph.push(plain);
        }
    }
    if !paragraph.is_empty() {
        last = paragraph;
    }
    if last.is_empty() {
        return None;
    }
    let text = last.join(" ");
    Some(clip(&crate::redact::mask(&text)))
}

/// At most [`MAX_CHARS`] characters, cut at a word when one ends near the limit.
fn clip(text: &str) -> String {
    if text.chars().count() <= MAX_CHARS {
        return text.to_owned();
    }
    let cut: String = text.chars().take(MAX_CHARS - 1).collect();
    let word = cut
        .rfind(char::is_whitespace)
        .filter(|at| cut[..*at].chars().count() > MAX_CHARS - 40)
        .map_or(cut.as_str(), |at| &cut[..at]);
    format!("{}…", word.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: MessageRole, content: &str) -> Message {
        serde_json::from_value(serde_json::json!({
            "id": content.len().to_string(), "sessionId": "s", "role": role, "content": content,
            "createdAt": "2026-10-19T00:00:00Z", "streaming": false,
        }))
        .unwrap()
    }

    #[test]
    fn takes_the_last_paragraph_as_plain_text() {
        let reply = "I'll read the code first.\n\n## Summary\n\nThe **sidebar** now shows a [hover card](https://x.dev) with `ConversationRow`.\n- It opens _after_ 450 ms\n";
        assert_eq!(
            excerpt(reply).as_deref(),
            Some("The sidebar now shows a hover card with ConversationRow. It opens after 450 ms")
        );
    }

    #[test]
    fn skips_code_blocks_rules_and_tables() {
        let reply =
            "Run this:\n\n```sh\nnpm test\n\nnpm run lint\n```\n\n---\n| a | b |\n|---|---|\n";
        assert_eq!(excerpt(reply).as_deref(), Some("a b"));
        assert_eq!(excerpt("```rust\nfn main() {}\n```"), None);
        assert_eq!(excerpt("Done.\n\n```\ncode\n```\n"), Some("Done.".into()));
        assert_eq!(
            excerpt("> **Note:** see ![diagram](d.png) and <https://sirus.dev>").as_deref(),
            Some("Note: see diagram and https://sirus.dev")
        );
    }

    #[test]
    fn keeps_snake_case_and_arithmetic() {
        assert_eq!(
            excerpt("Renamed `last_reply` in my_module and 2 * 3 * 4 still holds.").as_deref(),
            Some("Renamed last_reply in my_module and 2 * 3 * 4 still holds.")
        );
    }

    #[test]
    fn masks_credentials_and_bounds_the_length() {
        let token = format!("ghp_{}", "a1B2c3D4e5".repeat(4));
        let masked = excerpt(&format!("Use {token} to push.")).unwrap();
        assert!(!masked.contains(&token), "{masked}");
        let long = "word ".repeat(200);
        let clipped = excerpt(&long).unwrap();
        assert!(clipped.chars().count() <= MAX_CHARS);
        assert!(clipped.ends_with("word…"));
    }

    #[test]
    fn a_long_reply_reads_only_its_end_and_knows_open_fences() {
        let mut reply = "Intro paragraph.\n\n```\n".to_owned();
        reply.push_str(&"let x = 1;\n".repeat(1000));
        reply.push_str("```\n\nAll checks pass.");
        assert_eq!(excerpt(&reply).as_deref(), Some("All checks pass."));
        // The window starts inside the code block: its lines are not prose.
        let mut open = "Intro.\n\n```\n".to_owned();
        open.push_str(&"code line\n".repeat(1000));
        assert_eq!(excerpt(&open), None);
    }

    #[test]
    fn the_newest_reply_with_words_wins() {
        let messages = [
            message(MessageRole::User, "Fix it"),
            message(MessageRole::Agent, "Fixed the bug."),
            message(MessageRole::User, "Now test"),
            message(MessageRole::Agent, ""),
            message(MessageRole::System, "Stopped"),
        ];
        assert_eq!(of(&messages).as_deref(), Some("Fixed the bug."));
        assert_eq!(of(&messages[..1]), None);
    }

    #[test]
    fn an_unloaded_transcript_keeps_its_preview() {
        let mut list =
            crate::transcript_store::Messages::from(vec![message(MessageRole::Agent, "All set.")]);
        list.unload(crate::transcript_store::Origin::new(
            std::path::Path::new("/missing/state.json"),
            "s",
        ));
        assert!(!list.is_loaded());
        assert_eq!(list.reply_preview().as_deref(), Some("All set."));
    }
}
