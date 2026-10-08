use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const IGNORED_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
];

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn slug(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars().take(40) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "session".into()
    } else {
        trimmed
    }
}

pub fn canonicalize_existing(path: &Path) -> Result<PathBuf> {
    let canonical = path.canonicalize().map_err(|err| {
        Error::invalid_path(format!("path does not exist or cannot be read: {err}"))
    })?;
    if !canonical.is_absolute() {
        return Err(Error::invalid_path("path must be absolute"));
    }
    Ok(canonical)
}

pub fn ensure_dir(path: &Path) -> Result<PathBuf> {
    let canonical = canonicalize_existing(path)?;
    if !canonical.is_dir() {
        return Err(Error::invalid_path("path is not a directory"));
    }
    Ok(canonical)
}

pub fn ensure_within(root: &Path, candidate: &Path) -> Result<PathBuf> {
    let root = ensure_dir(root)?;
    let candidate = canonicalize_existing(candidate)?;
    if candidate == root || candidate.starts_with(&root) {
        return Ok(candidate);
    }
    Err(Error::invalid_path(
        "path escapes the allowed project or worktree root",
    ))
}

/// Verify the opened descriptor, not just the path checked before open. A
/// project process can replace a parent directory while a file is being opened.
pub fn verify_open_handle(root: &Path, file: &std::fs::File) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        let mut bytes = [0u8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        use std::os::unix::ffi::OsStrExt;
        ensure_within(root, Path::new(std::ffi::OsStr::from_bytes(&bytes[..end])))?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        let opened = std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))?;
        ensure_within(root, &opened)?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (root, file);
    }
    Ok(())
}

/// Open a local preview without blocking on a FIFO or following a substituted link.
pub fn open_regular_within(root: &Path, candidate: &Path) -> Result<std::fs::File> {
    let canonical = ensure_within(root, candidate)?;
    if !canonical.metadata()?.is_file() {
        return Err(Error::invalid_path("preview supports regular files only"));
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options.open(&canonical)?;
    if !file.metadata()?.is_file() {
        return Err(Error::invalid_path("preview supports regular files only"));
    }
    verify_open_handle(root, &file)?;
    Ok(file)
}

/// Open an existing regular file for overwrite without following links. The
/// caller verifies the handle, then truncates and writes, so a failed
/// verification never modifies project content.
pub fn open_regular_for_write_within(root: &Path, candidate: &Path) -> Result<std::fs::File> {
    let canonical = ensure_within(root, candidate)?;
    if !canonical.metadata()?.is_file() {
        return Err(Error::invalid_path("editor writes regular files only"));
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options.open(&canonical)?;
    if !file.metadata()?.is_file() {
        return Err(Error::invalid_path("editor writes regular files only"));
    }
    verify_open_handle(root, &file)?;
    Ok(file)
}

pub fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIR_NAMES.contains(&name)
}

/// Heavy or generated folder names every workspace walk skips.
pub fn ignored_dir_names() -> &'static [&'static str] {
    IGNORED_DIR_NAMES
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
