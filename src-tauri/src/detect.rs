use std::collections::HashMap;
use std::path::Path;

use crate::models::{AgentInstall, AgentProviderId, ExecutableCandidate};

struct KnownAgent {
    id: AgentProviderId,
    name: &'static str,
    binaries: &'static [&'static str],
}

const KNOWN: &[KnownAgent] = &[
    KnownAgent {
        id: AgentProviderId::Codex,
        name: "Codex",
        binaries: &["codex"],
    },
    KnownAgent {
        id: AgentProviderId::Claude,
        name: "Claude Code",
        binaries: &["claude"],
    },
    KnownAgent {
        id: AgentProviderId::OpenCode,
        name: "OpenCode",
        binaries: &["opencode"],
    },
    KnownAgent {
        id: AgentProviderId::Cursor,
        name: "Cursor",
        binaries: &["cursor-agent", "agent"],
    },
    KnownAgent {
        id: AgentProviderId::Grok,
        name: "Grok",
        binaries: &["grok"],
    },
    KnownAgent {
        id: AgentProviderId::Antigravity,
        name: "Antigravity",
        binaries: &["agy"],
    },
    KnownAgent {
        id: AgentProviderId::Droid,
        name: "Droid",
        binaries: &["droid"],
    },
    KnownAgent {
        id: AgentProviderId::Pi,
        name: "Pi",
        binaries: &["pi"],
    },
    KnownAgent {
        id: AgentProviderId::Devin,
        name: "Devin",
        binaries: &["devin"],
    },
    KnownAgent {
        id: AgentProviderId::Hermes,
        name: "Hermes",
        binaries: &["hermes"],
    },
];

pub(crate) fn cli_path() -> std::ffi::OsString {
    let mut dirs: Vec<_> = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .filter(|path| path.is_absolute())
        .collect();
    if let Some(home) = std::env::var_os("HOME") {
        let home = Path::new(&home);
        if home.is_absolute() {
            for relative in [".local/bin", ".opencode/bin", ".cursor/bin", ".bun/bin"] {
                dirs.push(home.join(relative));
            }
        }
    }
    #[cfg(unix)]
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(dir.into());
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// Child-only PATH for official user installations, including npm's env-node launcher.
/// Never invokes a login shell or accepts PATH entries from the renderer/project.
pub(crate) fn command(binary: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(binary);
    command.env("PATH", cli_path());
    command
}

pub fn detect_with_overrides(overrides: &HashMap<AgentProviderId, String>) -> Vec<AgentInstall> {
    KNOWN
        .iter()
        .map(|agent| resolve_known(agent, overrides.get(&agent.id).map(String::as_str)))
        .collect()
}

pub fn resolve_with_overrides(
    id: &AgentProviderId,
    overrides: &HashMap<AgentProviderId, String>,
) -> Option<AgentInstall> {
    KNOWN
        .iter()
        .find(|agent| agent.id == *id)
        .map(|agent| resolve_known(agent, overrides.get(id).map(String::as_str)))
}

pub async fn probe_executable(path: &str) -> (bool, Option<String>, String) {
    let file = Path::new(path);
    if !file.is_file() {
        return (false, None, "Executable is not a file".into());
    }
    match probe_version(path).await {
        Some(version) => (true, Some(version.clone()), format!("Responded: {version}")),
        None => (
            false,
            None,
            "Could not read a version from this executable".into(),
        ),
    }
}

/// Extra user install folders searched only to list alternatives (MonoCode #407).
const EXTRA_DIRS: &[&str] = &[
    ".npm-global/bin",
    ".volta/bin",
    ".claude/local",
    ".local/share/pnpm",
    "Library/pnpm",
    ".yarn/bin",
];
const MAX_CANDIDATES: usize = 8;

/// Every executable of this provider found in the CLI search path and the usual user
/// install folders, deduplicated by resolved file, first match first.
fn find_candidates(agent: &KnownAgent) -> Vec<ExecutableCandidate> {
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(&cli_path()).collect();
    if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
        if home.is_absolute() {
            dirs.extend(EXTRA_DIRS.iter().map(|relative| home.join(relative)));
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut found = Vec::new();
    for dir in dirs {
        for binary in agent.binaries {
            let path = dir.join(binary);
            if !is_executable(&path) || !cursor_agent_allowed(agent, binary, &path) {
                continue;
            }
            let Ok(real) = path.canonicalize() else {
                continue;
            };
            if seen.insert(real) && found.len() < MAX_CANDIDATES {
                found.push(ExecutableCandidate {
                    path: path.display().to_string(),
                    version: None,
                });
            }
        }
    }
    found
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.is_file() && meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        meta.is_file()
    }
}

/// Cursor's generic `agent` name only counts when it is Cursor's own launcher.
fn cursor_agent_allowed(agent: &KnownAgent, binary: &str, path: &Path) -> bool {
    !(agent.id == AgentProviderId::Cursor
        && binary == "agent"
        && !path.to_string_lossy().to_lowercase().contains("cursor"))
}

fn resolve_known(agent: &KnownAgent, override_path: Option<&str>) -> AgentInstall {
    let candidates = find_candidates(agent);
    if let Some(path) = override_path {
        let found = which::which(path).ok().and_then(|p| p.canonicalize().ok());
        return AgentInstall {
            id: agent.id.clone(),
            name: agent.name.into(),
            binary: agent.binaries[0].into(),
            installed: found.is_some(),
            path: Some(
                found
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| path.into()),
            ),
            version: None,
            candidates,
        };
    }
    let found = agent.binaries.iter().find_map(|binary| {
        // Desktop launches need not inherit an interactive shell's install locations.
        let path = which::which_in(binary, Some(cli_path()), std::env::temp_dir()).ok()?;
        if !cursor_agent_allowed(agent, binary, &path) {
            return None;
        }
        let display = path.display().to_string();
        Some(((*binary).to_string(), display))
    });
    match found {
        Some((binary, path)) => AgentInstall {
            id: agent.id.clone(),
            name: agent.name.into(),
            binary,
            installed: true,
            version: None,
            path: Some(path),
            candidates,
        },
        None => AgentInstall {
            id: agent.id.clone(),
            name: agent.name.into(),
            binary: agent.binaries[0].into(),
            installed: false,
            path: None,
            version: None,
            candidates,
        },
    }
}

pub async fn probe_version(path: &str) -> Option<String> {
    let output =
        crate::cli_output::capture(path, &["--version"], std::time::Duration::from_secs(3))
            .await
            .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    first_line(&stdout)
        .or_else(|| first_line(&stderr))
        .map(|line| line.chars().take(200).collect())
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn candidates_list_executables_once_and_skip_foreign_cursor_agents() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("sirus-detect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let tool = dir.join("agent");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        let plain = dir.join("plain");
        std::fs::write(&plain, "x").unwrap();
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(is_executable(&tool));
        assert!(!is_executable(&plain));
        assert!(!is_executable(&dir));
        let cursor = KNOWN
            .iter()
            .find(|agent| agent.id == AgentProviderId::Cursor)
            .unwrap();
        assert!(!cursor_agent_allowed(cursor, "agent", &tool));
        assert!(cursor_agent_allowed(
            cursor,
            "agent",
            Path::new("/Users/me/.cursor/bin/agent")
        ));
        assert!(cursor_agent_allowed(cursor, "cursor-agent", &tool));
        for agent in KNOWN {
            let list = find_candidates(agent);
            assert!(list.len() <= MAX_CANDIDATES);
            let unique = list
                .iter()
                .map(|item| Path::new(&item.path).canonicalize().unwrap())
                .collect::<std::collections::HashSet<_>>();
            assert_eq!(unique.len(), list.len());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
