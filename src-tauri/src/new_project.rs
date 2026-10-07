//! New project from a name (T3 Code #14527): a fresh folder under a chosen parent with
//! `git init`, a README and a first commit. The folder name is a slug of the name, so the
//! renderer never supplies a path segment; existing non-empty folders are refused.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const MAX_NAME_CHARS: usize = 100;
const MAX_SLUG_CHARS: usize = 64;

/// Lowercase ASCII letters, digits and single dashes; Portuguese accents fold to their letter.
pub(crate) fn slug(name: &str) -> Option<String> {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.chars().take(MAX_SLUG_CHARS).collect();
    let out = out.trim_matches('-');
    (!out.is_empty()).then(|| out.to_string())
}

pub(crate) fn validate_name(name: &str) -> Result<(String, String)> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(Error::new(
            "invalid_project_name",
            "Use a project name of 1–100 characters.",
        ));
    }
    let slug = slug(name).ok_or_else(|| {
        Error::new(
            "invalid_project_name",
            "The name needs at least one letter or digit.",
        )
    })?;
    Ok((name.to_string(), slug))
}

/// `~` / `~/…` expand to the home folder; anything else must already be absolute. A missing
/// parent is created only inside the home folder (the default is `~/Projetos`).
fn resolve_parent(parent: &str, home: Option<&Path>) -> Result<PathBuf> {
    let parent = parent.trim();
    if parent.is_empty() || parent.len() > 4096 || parent.chars().any(char::is_control) {
        return Err(Error::invalid_path("choose a parent folder"));
    }
    let raw = match (parent.strip_prefix('~'), home) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with('/') => {
            home.join(rest.trim_start_matches('/'))
        }
        _ => PathBuf::from(parent),
    };
    if !raw.is_absolute()
        || raw
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Error::invalid_path(
            "the parent folder must be an absolute path",
        ));
    }
    if !raw.exists() {
        let inside_home = home.is_some_and(|home| raw.starts_with(home) && raw != home);
        if !inside_home {
            return Err(Error::invalid_path("the parent folder does not exist"));
        }
        std::fs::create_dir_all(&raw).map_err(|err| {
            Error::invalid_path(format!("cannot create the parent folder: {err}"))
        })?;
    }
    crate::paths::ensure_dir(&raw)
}

/// Creates `<parent>/<slug>` with Git, README.md and a first commit; returns the folder.
pub(crate) fn create(name: &str, parent: &str) -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute());
    create_in(name, parent, home.as_deref(), &[])
}

/// `env` is only for tests (a fixed commit identity); the app uses the person's Git config.
fn create_in(
    name: &str,
    parent: &str,
    home: Option<&Path>,
    env: &[(&str, &std::ffi::OsStr)],
) -> Result<PathBuf> {
    let (name, slug) = validate_name(name)?;
    let target = resolve_parent(parent, home)?.join(&slug);
    let created = match std::fs::symlink_metadata(&target) {
        Ok(meta) => {
            let empty = meta.is_dir()
                && std::fs::read_dir(&target)
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false);
            if !empty {
                return Err(Error::new(
                    "project_exists",
                    format!("A folder named “{slug}” already exists there and is not empty."),
                ));
            }
            false
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&target)
                .map_err(|err| Error::invalid_path(format!("cannot create the folder: {err}")))?;
            true
        }
        Err(err) => {
            return Err(Error::invalid_path(format!(
                "cannot inspect the folder: {err}"
            )))
        }
    };
    let result = initialize(&target, &name, env);
    if result.is_err() {
        // Undo only what this call made: the new folder, or the files written into an empty one.
        if created {
            let _ = std::fs::remove_dir_all(&target);
        } else {
            let _ = std::fs::remove_file(target.join("README.md"));
            let _ = std::fs::remove_dir_all(target.join(".git"));
        }
    }
    result.map(|()| target)
}

fn initialize(target: &Path, name: &str, env: &[(&str, &std::ffi::OsStr)]) -> Result<()> {
    let step = |args: &[&str]| -> Result<()> {
        let output = if env.is_empty() {
            crate::git::bounded_run(target, args)?
        } else {
            crate::git::run_env(target, args, env)?
        };
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(Error::git(if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        }))
    };
    step(&["init", "-q"])?;
    std::fs::write(target.join("README.md"), format!("# {name}\n"))
        .map_err(|err| Error::invalid_path(format!("cannot write README.md: {err}")))?;
    step(&["add", "--", "README.md"])?;
    step(&["commit", "-q", "-m", "Initial commit"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_fold_accents_and_keep_only_safe_characters() {
        assert_eq!(
            slug("Meu Projeto Incrível").as_deref(),
            Some("meu-projeto-incrivel")
        );
        assert_eq!(slug("  ../../etc/passwd ").as_deref(), Some("etc-passwd"));
        assert_eq!(slug("Ação & Reação!").as_deref(), Some("acao-reacao"));
        assert_eq!(slug("🚀🚀"), None);
        assert_eq!(slug("---"), None);
        assert!(slug(&"a".repeat(200)).unwrap().len() <= MAX_SLUG_CHARS);
        assert!(validate_name("").is_err());
        assert!(validate_name("bad\nname").is_err());
        assert!(validate_name(&"x".repeat(101)).is_err());
        assert_eq!(
            validate_name(" Sirus ").unwrap(),
            ("Sirus".into(), "sirus".into())
        );
    }

    #[test]
    fn parents_must_be_absolute_and_are_created_only_inside_home() {
        let root = std::env::temp_dir().join(format!("sirus-new-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let home = root.canonicalize().unwrap();
        assert!(resolve_parent("relative/dir", Some(&home)).is_err());
        assert!(resolve_parent("/nonexistent-sirus-parent/x", Some(&home)).is_err());
        assert!(resolve_parent(&format!("{}/a/../b", home.display()), Some(&home)).is_err());
        assert_eq!(
            resolve_parent("~/Projetos", Some(&home)).unwrap(),
            home.join("Projetos")
        );
        assert!(resolve_parent("~other/x", Some(&home)).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_a_committed_repository_and_refuses_non_empty_folders() {
        let root = std::env::temp_dir().join(format!("sirus-new-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let home = root.canonicalize().unwrap();
        // A fixed identity so the first commit works on any machine.
        let env = [
            ("GIT_AUTHOR_NAME", std::ffi::OsStr::new("Sirus Test")),
            (
                "GIT_AUTHOR_EMAIL",
                std::ffi::OsStr::new("test@example.invalid"),
            ),
            ("GIT_COMMITTER_NAME", std::ffi::OsStr::new("Sirus Test")),
            (
                "GIT_COMMITTER_EMAIL",
                std::ffi::OsStr::new("test@example.invalid"),
            ),
            ("GIT_CONFIG_NOSYSTEM", std::ffi::OsStr::new("1")),
            ("GIT_CONFIG_GLOBAL", std::ffi::OsStr::new("/dev/null")),
        ];
        let target = create_in("Meu App", "~/Projetos", Some(&home), &env).unwrap();
        assert_eq!(target, home.join("Projetos/meu-app"));
        assert_eq!(
            std::fs::read_to_string(target.join("README.md")).unwrap(),
            "# Meu App\n"
        );
        let log = crate::git::run_ok(&target, &["log", "--pretty=%s"]).unwrap();
        assert_eq!(log, "Initial commit");
        let again = create_in("meu app", "~/Projetos", Some(&home), &env).unwrap_err();
        assert!(matches!(
            again,
            Error::App {
                code: "project_exists",
                ..
            }
        ));
        // An empty folder of that name is reused.
        std::fs::create_dir(home.join("Projetos/vazio")).unwrap();
        assert!(create_in("Vazio", "~/Projetos", Some(&home), &env).is_ok());
        // A failed step removes the folder it created.
        let broken = [(
            "GIT_DIR",
            std::ffi::OsStr::new("/nonexistent-sirus-git-dir"),
        )];
        assert!(create_in("Quebrado", "~/Projetos", Some(&home), &broken).is_err());
        assert!(!home.join("Projetos/quebrado").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
