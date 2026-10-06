//! One-time move of app data from the pre-rebrand `com.switchyard.app` directory.
//!
//! Everything except `worktrees/` moves by rename into the new app-data
//! directory. Isolated worktrees stay where they are: sessions, Git's own
//! worktree links and provider resume state record their absolute paths, so the
//! legacy `worktrees/` folder remains an owned root instead of being rewritten.

use std::path::{Path, PathBuf};

const LEGACY_IDENTIFIER: &str = "com.switchyard.app";
const STATE_FILE: &str = "state.json";
const WORKTREES: &str = "worktrees";

fn legacy_dir(data_dir: &Path) -> Option<PathBuf> {
    let legacy = data_dir.parent()?.join(LEGACY_IDENTIFIER);
    (legacy != data_dir).then_some(legacy)
}

/// Moves legacy data once, when the new directory has no state yet. The state
/// file moves last, so an interrupted move resumes on the next launch.
pub fn migrate(data_dir: &Path) -> std::io::Result<bool> {
    let Some(legacy) = legacy_dir(data_dir) else {
        return Ok(false);
    };
    if data_dir.join(STATE_FILE).exists() || !legacy.join(STATE_FILE).is_file() {
        return Ok(false);
    }
    std::fs::create_dir_all(data_dir)?;
    let mut entries = std::fs::read_dir(&legacy)?
        .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
        .filter(|name| name != WORKTREES)
        .collect::<Vec<_>>();
    entries.sort_by_key(|name| name == STATE_FILE);
    for name in entries {
        let target = data_dir.join(&name);
        if target.exists() {
            continue;
        }
        std::fs::rename(legacy.join(&name), target)?;
    }
    Ok(true)
}

/// The legacy worktree root that existing isolated sessions still live in.
pub fn worktree_root(data_dir: &Path) -> Option<PathBuf> {
    legacy_dir(data_dir)
        .map(|legacy| legacy.join(WORKTREES))
        .filter(|path| path.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_everything_but_worktrees_once() {
        let base = std::env::temp_dir().join(format!("sirus-legacy-{}", uuid::Uuid::new_v4()));
        let legacy = base.join(LEGACY_IDENTIFIER);
        let current = base.join("com.siruscode.app");
        std::fs::create_dir_all(legacy.join("sessions")).unwrap();
        std::fs::create_dir_all(legacy.join("worktrees/p/tree")).unwrap();
        std::fs::write(legacy.join(STATE_FILE), "{}").unwrap();
        std::fs::write(legacy.join("sessions/s.json"), "{}").unwrap();

        assert!(migrate(&current).unwrap());
        assert!(current.join(STATE_FILE).is_file());
        assert!(current.join("sessions/s.json").is_file());
        assert!(!current.join(WORKTREES).exists());
        assert!(legacy.join("worktrees/p/tree").is_dir());
        assert!(!legacy.join(STATE_FILE).exists());
        assert_eq!(worktree_root(&current), Some(legacy.join(WORKTREES)));

        std::fs::write(legacy.join(STATE_FILE), "{\"stale\":true}").unwrap();
        assert!(!migrate(&current).unwrap());
        assert_eq!(
            std::fs::read_to_string(current.join(STATE_FILE)).unwrap(),
            "{}"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn fresh_install_without_legacy_data_is_untouched() {
        let base = std::env::temp_dir().join(format!("sirus-fresh-{}", uuid::Uuid::new_v4()));
        let current = base.join("com.siruscode.app");
        assert!(!migrate(&current).unwrap());
        assert!(!current.exists());
        assert_eq!(worktree_root(&current), None);
    }
}
