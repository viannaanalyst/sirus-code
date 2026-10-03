use std::collections::HashMap;
use std::path::Path;

use crate::models::{AgentInstall, AgentProviderId};

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
];

fn cli_path() -> std::ffi::OsString {
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

fn resolve_known(agent: &KnownAgent, override_path: Option<&str>) -> AgentInstall {
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
        };
    }
    let found = agent.binaries.iter().find_map(|binary| {
        // Desktop launches need not inherit an interactive shell's install locations.
        let path = which::which_in(binary, Some(cli_path()), std::env::temp_dir()).ok()?;
        if agent.id == AgentProviderId::Cursor
            && *binary == "agent"
            && !path.to_string_lossy().to_lowercase().contains("cursor")
        {
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
        },
        None => AgentInstall {
            id: agent.id.clone(),
            name: agent.name.into(),
            binary: agent.binaries[0].into(),
            installed: false,
            path: None,
            version: None,
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
