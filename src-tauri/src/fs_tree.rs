use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};
use crate::models::FileEntry;
use crate::paths::{display_path, ensure_within, is_ignored_dir};

pub fn list_children(root: &Path, dir: &Path) -> Result<Vec<FileEntry>> {
    let dir = ensure_within(root, dir)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env.example" {
            // keep dotfiles visible except heavy/system dirs
            if is_ignored_dir(&name) {
                continue;
            }
        }
        if is_ignored_dir(&name) {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type()?.is_dir();
        entries.push(FileEntry {
            name,
            path: display_path(&path),
            is_dir,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileSuggestion {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFiles {
    pub entries: Vec<WorkspaceFileSuggestion>,
    pub truncated: bool,
}

/// Names only, on demand. Empty/path queries browse one directory; a bare
/// filename searches the workspace within fixed traversal/output budgets.
pub fn suggest_files(root: &Path, query: &str) -> Result<WorkspaceFiles> {
    if query.len() > 1024
        || query.chars().any(|ch| ch.is_control() || ch == '\\')
        || query.starts_with('/')
        || query
            .split('/')
            .any(|part| part == ".." || part == "." || is_ignored_dir(part))
    {
        return Err(Error::invalid_path("invalid workspace file query"));
    }
    let root = crate::paths::ensure_dir(root)?;
    if let Some((parent, _)) = query.rsplit_once('/') {
        let mut candidate = root.clone();
        for part in parent.split('/').filter(|part| !part.is_empty()) {
            candidate.push(part);
            if fs::symlink_metadata(&candidate)?.file_type().is_symlink() {
                return Err(Error::invalid_path(
                    "linked workspace directory is unavailable",
                ));
            }
        }
    }
    let (directory, needle, recursive) = match query.rsplit_once('/') {
        Some((parent, needle)) => (
            ensure_within(&root, &root.join(parent))?,
            needle.to_lowercase(),
            false,
        ),
        None => (root.clone(), query.to_lowercase(), !query.is_empty()),
    };
    let mut pending = VecDeque::from([(directory, 0)]);
    let mut result = WorkspaceFiles {
        entries: Vec::new(),
        truncated: false,
    };
    let started = Instant::now();
    let mut scanned = 0;
    'scan: while let Some((directory, depth)) = pending.pop_front() {
        let Ok(directory) = ensure_within(&root, &directory) else {
            continue;
        };
        let children = match fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) if depth == 0 => return Err(error.into()),
            Err(_) => continue,
        };
        let mut subdirectories = Vec::new();
        for child in children {
            if scanned >= 8192 || started.elapsed() >= Duration::from_millis(150) {
                result.truncated = true;
                break 'scan;
            }
            scanned += 1;
            let Ok(child) = child else {
                continue;
            };
            let name = child.file_name().to_string_lossy().to_string();
            if is_ignored_dir(&name) || name.contains('\\') {
                continue;
            }
            let Ok(kind) = child.file_type() else {
                continue;
            };
            // Never follow links or enumerate special files in suggestions.
            if !kind.is_dir() && !kind.is_file() {
                continue;
            }
            let path = child.path();
            if ensure_within(&root, &path).is_err() {
                continue;
            }
            let relative = path
                .strip_prefix(&root)
                .map_err(|_| Error::invalid_path("foreign workspace file"))?;
            let relative = display_path(relative).replace('\\', "/");
            // Control characters cannot become usable composer references.
            if relative.chars().any(char::is_control) {
                continue;
            }
            let searchable = if recursive { &relative } else { &name };
            if searchable.to_lowercase().contains(&needle) {
                if result.entries.len() == 64 {
                    result.truncated = true;
                    break 'scan;
                }
                result.entries.push(WorkspaceFileSuggestion {
                    path: relative,
                    is_dir: kind.is_dir(),
                });
            }
            if recursive && kind.is_dir() {
                if depth < 12 {
                    subdirectories.push(path);
                } else {
                    result.truncated = true;
                }
            }
        }
        subdirectories.sort();
        pending.extend(subdirectories.into_iter().map(|path| (path, depth + 1)));
    }
    result.entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_browse_search_and_keep_relative_names() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::write(root.path().join("src/AgentComposer.tsx"), "private content").unwrap();
        fs::write(root.path().join("notes file.md"), "notes").unwrap();
        fs::create_dir(root.path().join("node_modules")).unwrap();
        fs::write(root.path().join("node_modules/AgentSecret.tsx"), "excluded").unwrap();
        let initial = suggest_files(root.path(), "").unwrap();
        assert_eq!(initial.entries.len(), 2);
        assert_eq!(initial.entries[0].path, "src");
        let search = suggest_files(root.path(), "agentcomposer").unwrap();
        assert_eq!(search.entries.len(), 1);
        assert_eq!(search.entries[0].path, "src/AgentComposer.tsx");
        assert!(!search.truncated);
        assert_eq!(
            suggest_files(root.path(), "src/Agent")
                .unwrap()
                .entries
                .len(),
            1
        );
        assert_eq!(suggest_files(root.path(), "src/").unwrap().entries.len(), 1);
        assert!(suggest_files(root.path(), "absent")
            .unwrap()
            .entries
            .is_empty());
        for query in [
            "../",
            "/tmp",
            "src/../../",
            "node_modules/",
            ".git/",
            "a\\b",
            "\n",
        ] {
            assert!(suggest_files(root.path(), query).is_err(), "{query:?}");
        }
        assert!(suggest_files(root.path(), &"a".repeat(1025)).is_err());
    }

    #[test]
    fn suggestions_bound_large_directories_and_report_truncation() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..70 {
            fs::write(root.path().join(format!("file{index}.txt")), "").unwrap();
        }
        let result = suggest_files(root.path(), "").unwrap();
        assert_eq!(result.entries.len(), 64);
        assert!(result.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn suggestions_do_not_follow_links_or_expose_foreign_names() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("foreign")).unwrap();
        std::os::unix::fs::symlink(root.path(), root.path().join("cycle")).unwrap();
        assert!(suggest_files(root.path(), "").unwrap().entries.is_empty());
        assert!(suggest_files(root.path(), "secret")
            .unwrap()
            .entries
            .is_empty());
        assert!(suggest_files(root.path(), "foreign/").is_err());
    }
}
