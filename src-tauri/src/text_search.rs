//! Text search inside one workspace for the Files pane (ADR-095).
//!
//! Prefers `rg --json` (respects `.gitignore`, skips binaries); without ripgrep it
//! asks Git for the non-ignored file list, and outside a repository it walks the
//! tree itself. Every path is bounded: matches, files, line length, file size and
//! a wall-clock deadline. Links are never followed and every file is checked to be
//! inside the canonical root before it is read.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};
use crate::models::{TextSearchFile, TextSearchMatch, TextSearchResult};
use crate::paths::{ensure_dir, ensure_within, is_ignored_dir};

pub const MAX_MATCHES: usize = 2000;
pub const MAX_FILES: usize = 200;
pub const MAX_LINE_CHARS: usize = 240;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_QUERY_CHARS: usize = 512;
const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_WALK_ENTRIES: usize = 100_000;
const MAX_WALK_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy)]
struct Limits {
    matches: usize,
    files: usize,
    deadline: Instant,
}

impl Limits {
    fn new() -> Self {
        Self {
            matches: MAX_MATCHES,
            files: MAX_FILES,
            deadline: Instant::now() + TIMEOUT,
        }
    }
}

/// Collects grouped results and enforces the file/match budgets.
struct Collector {
    files: Vec<TextSearchFile>,
    index: HashMap<String, usize>,
    matches: usize,
    truncated: bool,
    limits: Limits,
}

impl Collector {
    fn new(limits: Limits) -> Self {
        Self {
            files: Vec::new(),
            index: HashMap::new(),
            matches: 0,
            truncated: false,
            limits,
        }
    }

    fn expired(&mut self) -> bool {
        if Instant::now() >= self.limits.deadline {
            self.truncated = true;
        }
        self.truncated
    }

    /// Returns false once a budget is exhausted (and marks the result truncated).
    fn push(&mut self, path: &str, found: TextSearchMatch) -> bool {
        if self.truncated {
            return false;
        }
        if self.matches >= self.limits.matches {
            self.truncated = true;
            return false;
        }
        let slot = match self.index.get(path) {
            Some(slot) => *slot,
            None => {
                if self.files.len() >= self.limits.files {
                    self.truncated = true;
                    return false;
                }
                self.files.push(TextSearchFile {
                    path: path.to_string(),
                    matches: Vec::new(),
                });
                self.index.insert(path.to_string(), self.files.len() - 1);
                self.files.len() - 1
            }
        };
        self.files[slot].matches.push(found);
        self.matches += 1;
        true
    }

    fn finish(mut self) -> TextSearchResult {
        self.files.sort_by(|a, b| a.path.cmp(&b.path));
        for file in &mut self.files {
            file.matches.sort_by_key(|found| (found.line, found.column));
        }
        TextSearchResult {
            files: self.files,
            truncated: self.truncated,
        }
    }
}

fn validate(query: &str) -> Result<()> {
    let length = query.chars().count();
    if !(2..=MAX_QUERY_CHARS).contains(&length) || query.chars().any(char::is_control) {
        return Err(Error::invalid_path("invalid search query"));
    }
    Ok(())
}

/// Searches `root` for the literal `query`.
pub fn search(root: &Path, query: &str, case_sensitive: bool) -> Result<TextSearchResult> {
    validate(query)?;
    let root = ensure_dir(root)?;
    let limits = Limits::new();
    if let Some(rg) = ripgrep_binary() {
        if let Some(result) = search_with_ripgrep(&rg, &root, query, case_sensitive, limits) {
            return Ok(result);
        }
    }
    if let Some(result) = search_with_git(&root, query, case_sensitive, limits) {
        return Ok(result);
    }
    search_with_walk(&root, query, case_sensitive, limits)
}

/// The first executable `rg` on the app's bounded CLI PATH (never a login shell).
fn ripgrep_binary() -> Option<PathBuf> {
    std::env::split_paths(&crate::detect::cli_path())
        .map(|dir| dir.join("rg"))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        metadata.is_file()
    }
}

struct Streamed {
    status: Option<ExitStatus>,
    timed_out: bool,
}

/// Runs `command`, handing each `delimiter`-terminated record to `each` until it
/// returns false. The process is killed at `deadline` or once `each` stops.
fn stream(
    mut command: Command,
    deadline: Instant,
    delimiter: u8,
    max_record: usize,
    mut each: impl FnMut(&[u8]) -> bool,
) -> Option<Streamed> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let (done, finished) = mpsc::channel::<()>();
    let timeout = deadline.saturating_duration_since(Instant::now());
    let watchdog = std::thread::spawn(move || {
        let timed_out = matches!(
            finished.recv_timeout(timeout),
            Err(mpsc::RecvTimeoutError::Timeout)
        );
        if timed_out {
            let _ = child.kill();
        }
        (timed_out, child)
    });
    let mut reader = BufReader::new(stdout);
    let mut record = Vec::new();
    let mut stopped = false;
    loop {
        record.clear();
        // A record longer than the budget is drained and skipped, never buffered whole.
        match (&mut reader)
            .take(max_record as u64)
            .read_until(delimiter, &mut record)
        {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if record.last() != Some(&delimiter) && record.len() >= max_record {
            let mut skipped = Vec::new();
            loop {
                skipped.clear();
                match (&mut reader)
                    .take(max_record as u64)
                    .read_until(delimiter, &mut skipped)
                {
                    Ok(0) | Err(_) => break,
                    Ok(_) if skipped.last() == Some(&delimiter) => break,
                    Ok(_) => {}
                }
            }
            continue;
        }
        if !each(&record) {
            stopped = true;
            break;
        }
    }
    let _ = done.send(());
    drop(reader);
    let (timed_out, mut child) = watchdog.join().ok()?;
    if stopped {
        let _ = child.kill();
    }
    let status = child.wait().ok();
    Some(Streamed { status, timed_out })
}

fn search_with_ripgrep(
    rg: &Path,
    root: &Path,
    query: &str,
    case_sensitive: bool,
    limits: Limits,
) -> Option<TextSearchResult> {
    let mut command = Command::new(rg);
    command
        .current_dir(root)
        .env_remove("RIPGREP_CONFIG_PATH")
        .args([
            "--json",
            "--no-config",
            "--fixed-strings",
            "--hidden",
            "--no-follow",
            "--max-filesize",
            "1M",
            "--max-columns",
            "4096",
            "--max-columns-preview",
        ])
        .arg(if case_sensitive {
            "--case-sensitive"
        } else {
            "--ignore-case"
        });
    for name in crate::paths::ignored_dir_names() {
        command.arg("--glob").arg(format!("!{name}"));
    }
    command.arg("--regexp").arg(query).arg("--").arg("./");
    let mut collector = Collector::new(limits);
    let streamed = stream(command, limits.deadline, b'\n', 64 * 1024, |record| {
        let Ok(event) = serde_json::from_slice::<serde_json::Value>(record) else {
            return true;
        };
        if event.get("type").and_then(|kind| kind.as_str()) != Some("match") {
            return true;
        }
        let data = &event["data"];
        let (Some(path), Some(text), Some(line)) = (
            data["path"]["text"].as_str(),
            data["lines"]["text"].as_str(),
            data["line_number"].as_u64(),
        ) else {
            return true;
        };
        let Some(path) = checked_relative(root, path.trim_start_matches("./")) else {
            return true;
        };
        let start = data["submatches"][0]["start"].as_u64().unwrap_or(0) as usize;
        let start = if text.is_char_boundary(start) {
            start
        } else {
            0
        };
        let (excerpt, column) = excerpt(text, start);
        collector.push(
            &path,
            TextSearchMatch {
                line: u32::try_from(line).unwrap_or(u32::MAX),
                column,
                text: excerpt,
            },
        ) && !collector.expired()
    })?;
    // Exit 2 with no output means ripgrep itself failed; let the fallback try.
    if streamed.timed_out {
        collector.truncated = true;
    } else if streamed.status.and_then(|status| status.code()) == Some(2)
        && collector.files.is_empty()
    {
        return None;
    }
    Some(collector.finish())
}

/// Git's list of tracked and untracked, non-ignored files (so `.gitignore` holds).
fn search_with_git(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    limits: Limits,
) -> Option<TextSearchResult> {
    let mut command = Command::new(crate::git::git_binary());
    command
        .current_dir(root)
        .env_remove("GIT_CONFIG")
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "-c",
            "core.fsmonitor=false",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ]);
    let mut collector = Collector::new(limits);
    let streamed = stream(command, limits.deadline, 0, 8 * 1024, |record| {
        let relative = String::from_utf8_lossy(record.strip_suffix(&[0]).unwrap_or(record));
        if relative
            .split('/')
            .any(|part| is_ignored_dir(part) || part == "..")
        {
            return true;
        }
        if let Some(relative) = checked_relative(root, &relative) {
            search_file(root, &relative, query, case_sensitive, &mut collector);
        }
        !collector.truncated && !collector.expired()
    })?;
    if streamed.status.is_none_or(|status| !status.success()) && !streamed.timed_out {
        return None;
    }
    if streamed.timed_out {
        collector.truncated = true;
    }
    Some(collector.finish())
}

/// Bounded breadth-first walk for folders outside Git (no `.gitignore` support).
fn search_with_walk(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    limits: Limits,
) -> Result<TextSearchResult> {
    let mut collector = Collector::new(limits);
    let mut pending = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut scanned = 0usize;
    'walk: while let Some((directory, depth)) = pending.pop_front() {
        let Ok(children) = fs::read_dir(&directory) else {
            continue;
        };
        let mut entries: Vec<_> = children.filter_map(|child| child.ok()).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for child in entries {
            scanned += 1;
            if scanned > MAX_WALK_ENTRIES || collector.expired() {
                collector.truncated = true;
                break 'walk;
            }
            let name = child.file_name().to_string_lossy().to_string();
            if is_ignored_dir(&name) {
                continue;
            }
            // DirEntry::file_type does not follow links: links are skipped entirely.
            let Ok(kind) = child.file_type() else {
                continue;
            };
            let path = child.path();
            if kind.is_dir() {
                if depth < MAX_WALK_DEPTH {
                    pending.push_back((path, depth + 1));
                }
            } else if kind.is_file() {
                let Ok(relative) = path.strip_prefix(root) else {
                    continue;
                };
                let relative = relative.to_string_lossy().replace('\\', "/");
                search_file(root, &relative, query, case_sensitive, &mut collector);
                if collector.truncated {
                    break 'walk;
                }
            }
        }
    }
    Ok(collector.finish())
}

/// A relative, link-free path that stays inside `root`, or None.
fn checked_relative(root: &Path, relative: &str) -> Option<String> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative.chars().any(char::is_control)
        || relative.split('/').any(|part| part == "..")
    {
        return None;
    }
    let path = root.join(relative);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    ensure_within(root, &path).ok()?;
    Some(relative.to_string())
}

fn search_file(
    root: &Path,
    relative: &str,
    query: &str,
    case_sensitive: bool,
    collector: &mut Collector,
) {
    let path = root.join(relative);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return;
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(bytes) = fs::read(&path) else {
        return;
    };
    if bytes.len() as u64 > MAX_FILE_BYTES || bytes.iter().take(8192).any(|byte| *byte == 0) {
        return;
    }
    let text = String::from_utf8_lossy(&bytes);
    let folded_query: Vec<char> = if case_sensitive {
        Vec::new()
    } else {
        query.chars().flat_map(char::to_lowercase).collect()
    };
    for (index, line) in text.lines().enumerate() {
        let found = if case_sensitive {
            line.find(query)
        } else {
            find_folded(line, &folded_query)
        };
        if let Some(start) = found {
            let (excerpt, column) = excerpt(line, start);
            let line = u32::try_from(index + 1).unwrap_or(u32::MAX);
            if !collector.push(
                relative,
                TextSearchMatch {
                    line,
                    column,
                    text: excerpt,
                },
            ) {
                return;
            }
        }
    }
}

/// Byte offset of the first case-insensitive occurrence of `needle` (already lowercased).
fn find_folded(line: &str, needle: &[char]) -> Option<usize> {
    if line.is_ascii() && needle.iter().all(char::is_ascii) {
        let needle: Vec<u8> = needle.iter().map(|ch| *ch as u8).collect();
        return line
            .as_bytes()
            .windows(needle.len())
            .position(|window| window.eq_ignore_ascii_case(&needle));
    }
    line.char_indices().map(|(start, _)| start).find(|start| {
        let mut folded = line[*start..].chars().flat_map(char::to_lowercase);
        needle.iter().all(|wanted| folded.next() == Some(*wanted))
    })
}

/// A trimmed excerpt around the match and the 1-based character column of `start`.
pub fn excerpt(line: &str, start: usize) -> (String, u32) {
    let line = line.trim_end_matches(['\r', '\n']);
    let start = start.min(line.len());
    let column = line[..start].chars().count();
    let total = line.chars().count();
    let text = if total <= MAX_LINE_CHARS {
        line.trim_start().to_string()
    } else {
        let from = column.saturating_sub(60).min(total - MAX_LINE_CHARS);
        let mut text: String = line.chars().skip(from).take(MAX_LINE_CHARS).collect();
        if from > 0 {
            text.insert(0, '…');
        } else {
            text = text.trim_start().to_string();
        }
        if from + MAX_LINE_CHARS < total {
            text.push('…');
        }
        text
    };
    (text, u32::try_from(column + 1).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tight(matches: usize, files: usize) -> Limits {
        Limits {
            matches,
            files,
            deadline: Instant::now() + TIMEOUT,
        }
    }

    fn paths(result: &TextSearchResult) -> Vec<&str> {
        result.files.iter().map(|file| file.path.as_str()).collect()
    }

    fn git(root: &Path, args: &[&str]) {
        assert!(Command::new(crate::git::git_binary())
            .current_dir(root)
            .args(args)
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn queries_are_validated() {
        let root = tempfile::tempdir().unwrap();
        for query in ["", "a", "two\nlines", "tab\there"] {
            assert!(search(root.path(), query, false).is_err(), "{query:?}");
        }
        assert!(search(root.path(), &"a".repeat(MAX_QUERY_CHARS + 1), false).is_err());
        assert!(search(root.path(), "ok", false).unwrap().files.is_empty());
    }

    #[test]
    fn walk_finds_lines_skips_heavy_dirs_binaries_and_large_files() {
        let root = tempfile::tempdir().unwrap();
        let base = ensure_dir(root.path()).unwrap();
        fs::create_dir(base.join("src")).unwrap();
        fs::write(
            base.join("src/app.ts"),
            "const a = 1;\n  let Needle = 2;\nneedle();\n",
        )
        .unwrap();
        fs::create_dir(base.join("node_modules")).unwrap();
        fs::write(base.join("node_modules/dep.js"), "needle").unwrap();
        fs::write(base.join("image.bin"), b"needle\0\0binary").unwrap();
        fs::write(base.join("huge.txt"), "needle\n".repeat(200_000)).unwrap();
        let result = search_with_walk(&base, "needle", false, Limits::new()).unwrap();
        assert_eq!(paths(&result), ["src/app.ts"]);
        assert_eq!(
            result.files[0].matches,
            [
                TextSearchMatch {
                    line: 2,
                    column: 7,
                    text: "let Needle = 2;".into()
                },
                TextSearchMatch {
                    line: 3,
                    column: 1,
                    text: "needle();".into()
                },
            ]
        );
        let sensitive = search_with_walk(&base, "Needle", true, Limits::new()).unwrap();
        assert_eq!(sensitive.files[0].matches.len(), 1);
        assert!(!result.truncated);
    }

    #[test]
    fn git_listing_respects_gitignore() {
        let root = tempfile::tempdir().unwrap();
        let base = ensure_dir(root.path()).unwrap();
        git(&base, &["init", "-q"]);
        fs::write(base.join(".gitignore"), "secret.txt\nlogs/\n").unwrap();
        fs::write(base.join("kept.txt"), "find me\n").unwrap();
        fs::write(base.join("secret.txt"), "find me\n").unwrap();
        fs::create_dir(base.join("logs")).unwrap();
        fs::write(base.join("logs/out.txt"), "find me\n").unwrap();
        let result = search_with_git(&base, "find me", false, Limits::new()).unwrap();
        assert_eq!(paths(&result), ["kept.txt"]);
        if let Some(rg) = ripgrep_binary() {
            let result = search_with_ripgrep(&rg, &base, "find me", false, Limits::new()).unwrap();
            assert_eq!(paths(&result), ["kept.txt"]);
            assert_eq!(
                result.files[0].matches,
                [TextSearchMatch {
                    line: 1,
                    column: 1,
                    text: "find me".into()
                }]
            );
            let bounded =
                search_with_ripgrep(&rg, &base, "find me", false, tight(1000, 0)).unwrap();
            assert!(bounded.files.is_empty() && bounded.truncated);
        }
        assert_eq!(
            paths(&search(&base, "find me", false).unwrap()),
            ["kept.txt"]
        );
        // Outside a repository Git declines and the walk takes over.
        let plain = tempfile::tempdir().unwrap();
        assert!(search_with_git(
            &ensure_dir(plain.path()).unwrap(),
            "x",
            false,
            Limits::new()
        )
        .is_none_or(|result| result.files.is_empty()));
    }

    #[test]
    fn results_are_bounded_by_files_and_matches() {
        let root = tempfile::tempdir().unwrap();
        let base = ensure_dir(root.path()).unwrap();
        for index in 0..12 {
            fs::write(base.join(format!("f{index:02}.txt")), "hit\n").unwrap();
        }
        let files = search_with_walk(&base, "hit", false, tight(1000, 10)).unwrap();
        assert_eq!(files.files.len(), 10);
        assert!(files.truncated);
        fs::write(base.join("many.txt"), "hit\n".repeat(50)).unwrap();
        let matches = search_with_walk(&base, "hit", false, tight(20, 100)).unwrap();
        assert_eq!(
            matches
                .files
                .iter()
                .map(|file| file.matches.len())
                .sum::<usize>(),
            20
        );
        assert!(matches.truncated);
        let expired = Limits {
            deadline: Instant::now(),
            ..Limits::new()
        };
        assert!(
            search_with_walk(&base, "hit", false, expired)
                .unwrap()
                .truncated
        );
    }

    #[test]
    fn long_lines_are_trimmed_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let (text, column) = excerpt(&line, 500);
        assert_eq!(column, 501);
        assert!(text.starts_with('…') && text.ends_with('…'));
        assert!(text.contains("needle"));
        assert_eq!(text.chars().count(), MAX_LINE_CHARS + 2);
        assert_eq!(excerpt("  short\r\n", 2), ("short".to_string(), 3));
        assert_eq!(find_folded("ÄBC straße", &['ß']), Some(9));
        assert_eq!(find_folded("Hello", &['l', 'o']), Some(3));
    }

    #[cfg(unix)]
    #[test]
    fn links_and_escaping_paths_are_never_followed() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let base = ensure_dir(root.path()).unwrap();
        fs::write(outside.path().join("secret.txt"), "classified\n").unwrap();
        std::os::unix::fs::symlink(outside.path(), base.join("linked-dir")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), base.join("linked.txt"))
            .unwrap();
        assert!(search_with_walk(&base, "classified", false, Limits::new())
            .unwrap()
            .files
            .is_empty());
        assert!(search(&base, "classified", false).unwrap().files.is_empty());
        for escape in [
            "../secret.txt",
            "/etc/hosts",
            "linked.txt",
            "linked-dir/secret.txt",
        ] {
            assert!(checked_relative(&base, escape).is_none(), "{escape}");
        }
        if let Some(rg) = ripgrep_binary() {
            assert!(
                search_with_ripgrep(&rg, &base, "classified", false, Limits::new())
                    .unwrap()
                    .files
                    .is_empty()
            );
        }
        git(&base, &["init", "-q"]);
        git(&base, &["add", "-A"]);
        assert!(search_with_git(&base, "classified", false, Limits::new())
            .unwrap()
            .files
            .is_empty());
    }
}
