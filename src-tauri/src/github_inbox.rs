//! Pull request and issue inbox across owned projects (ADR-050).
//!
//! Repositories come only from each saved project's `origin` remote. Every call
//! uses the person's existing `gh` login through the hardened `gh` command from
//! `pull_requests.rs`; queries and endpoints are fixed, and renderer input is
//! limited to validated repository names, numbers and closed enums. Changes on
//! GitHub (merge, draft/ready, close/reopen, comment) need `confirm: true` and a
//! repository the person owns as a project.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::pull_requests::{github_link, hardened, repository, sha, text, LookupStatus};

const MAX_REPOSITORIES: usize = 24;
const PAGE: u32 = 50;
const TITLE_LIMIT: usize = 300;
const BODY_LIMIT: usize = 65_536;
const COMMENT_LIMIT: usize = 16_384;
const DIFF_LIMIT: usize = 2 * 1024 * 1024;
const COMMENT_BODY_LIMIT: usize = 65_536;
/// Failing checks described for an agent: at most this many, each with a bounded log excerpt.
const MAX_FAILURES: usize = 10;
const LOG_EXCERPT_LIMIT: usize = 4_000;
/// All log excerpts together stay well under the 64 KiB composer draft bound.
const LOG_BUDGET: usize = 32_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    PullRequest,
    Issue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemState {
    Open,
    /// Closed without merging (for issues: every closed issue).
    Closed,
    /// Merged pull requests.
    Merged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl MergeMethod {
    fn api(self) -> &'static str {
        match self {
            MergeMethod::Merge => "merge",
            MergeMethod::Squash => "squash",
            MergeMethod::Rebase => "rebase",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    /// Open or closed pull requests/issues of every owned GitHub repository.
    List { kind: ItemKind, state: ItemState },
    Detail {
        repository: String,
        number: u32,
        kind: ItemKind,
    },
    /// Unified diff of one pull request (bounded).
    Diff { repository: String, number: u32 },
    /// Every failing check of the pull request's latest commit, with its
    /// annotations and a bounded excerpt of the GitHub Actions job log.
    Failures { repository: String, number: u32 },
    Merge {
        repository: String,
        number: u32,
        method: MergeMethod,
        /// GitHub refuses the merge if the head moved after the person looked.
        expected_head: String,
        confirm: bool,
    },
    SetDraft {
        repository: String,
        number: u32,
        draft: bool,
        confirm: bool,
    },
    SetOpen {
        repository: String,
        number: u32,
        kind: ItemKind,
        open: bool,
        confirm: bool,
    },
    Comment {
        repository: String,
        number: u32,
        body: String,
        confirm: bool,
    },
    /// Pushes the session branch, then opens a pull request from it into the
    /// repository's default branch.
    Create {
        session_id: String,
        title: String,
        body: String,
        draft: bool,
        confirm: bool,
    },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Response {
    Inbox(Inbox),
    Detail(Box<Detail>),
    Diff {
        text: String,
        truncated: bool,
    },
    Failures {
        checks: Vec<FailedCheck>,
        /// More checks failed than were described.
        truncated: bool,
    },
    Created {
        url: String,
    },
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedCheck {
    pub name: String,
    pub url: Option<String>,
    /// The check's own title/summary/description, when it reports one.
    pub summary: Option<String>,
    /// `path:line message` lines from the check's annotations.
    pub annotations: Vec<String>,
    /// Error-focused excerpt of the GitHub Actions job log; `None` when the
    /// check is not an Actions job or the log could not be read.
    pub log: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub viewer: Option<String>,
    pub repositories: Vec<Repository>,
    pub items: Vec<Item>,
    pub failures: Vec<Failure>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub repository: String,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub repository: String,
    pub status: LookupStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub kind: ItemKind,
    pub repository: String,
    pub number: u32,
    pub title: String,
    pub url: String,
    /// `open`, `closed` or `merged`.
    pub state: String,
    pub is_draft: bool,
    pub author: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub review_decision: Option<String>,
    pub mergeable: Option<String>,
    pub labels: Vec<Label>,
    pub comment_count: u32,
    pub assignees: Vec<String>,
    pub review_requests: Vec<String>,
    /// Combined check state: SUCCESS, FAILURE, PENDING, ERROR, EXPECTED.
    pub checks: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    /// passed, failed, pending, skipped or unknown.
    pub status: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub author: Option<String>,
    pub state: String,
    pub body: String,
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub author: Option<String>,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub oid: String,
    pub headline: String,
    pub author: Option<String>,
    pub committed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub change_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub item: Item,
    pub body: String,
    pub head_oid: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub merge_state_status: Option<String>,
    pub changed_files: u32,
    pub viewer_can_update: bool,
    pub merge_methods: Vec<MergeMethod>,
    pub checks: Vec<Check>,
    pub reviewers: Vec<String>,
    pub reviews: Vec<Review>,
    pub comments: Vec<Comment>,
    pub commits: Vec<Commit>,
    pub files: Vec<ChangedFile>,
    pub files_truncated: bool,
}

#[tauri::command]
pub async fn pull_request_action(
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Response> {
    let state = state.inner().clone();
    let snapshot = state.clone();
    let repositories = native_task(move || owned_repositories(&snapshot)).await?;
    let binary = OsStr::new("gh");
    match action {
        Action::List { kind, state } => Ok(Response::Inbox(
            list(binary, repositories, kind, state).await,
        )),
        Action::Detail {
            repository,
            number,
            kind,
        } => {
            let repo = owned(&repositories, &repository, number)?;
            Ok(Response::Detail(Box::new(
                detail(binary, repo, number, kind).await?,
            )))
        }
        Action::Diff { repository, number } => {
            let repo = owned(&repositories, &repository, number)?;
            let (text, truncated) = diff(binary, repo, number).await?;
            Ok(Response::Diff { text, truncated })
        }
        Action::Failures { repository, number } => {
            let repo = owned(&repositories, &repository, number)?;
            let (checks, truncated) = failures(binary, repo, number).await?;
            Ok(Response::Failures { checks, truncated })
        }
        Action::Merge {
            repository,
            number,
            method,
            expected_head,
            confirm,
        } => {
            let repo = owned(&repositories, &repository, number)?;
            confirmed(confirm)?;
            if !sha(&expected_head) {
                return Err(Error::new("invalid", "Invalid pull request head."));
            }
            let endpoint = format!("/repos/{repo}/pulls/{number}/merge");
            rest(
                binary,
                "PUT",
                &endpoint,
                &[
                    ("merge_method", method.api()),
                    ("sha", &expected_head.to_ascii_lowercase()),
                ],
            )
            .await?;
            Ok(Response::Done)
        }
        Action::SetDraft {
            repository,
            number,
            draft,
            confirm,
        } => {
            let repo = owned(&repositories, &repository, number)?;
            confirmed(confirm)?;
            set_draft(binary, repo, number, draft).await?;
            Ok(Response::Done)
        }
        Action::SetOpen {
            repository,
            number,
            kind,
            open,
            confirm,
        } => {
            let repo = owned(&repositories, &repository, number)?;
            confirmed(confirm)?;
            let path = if kind == ItemKind::PullRequest {
                "pulls"
            } else {
                "issues"
            };
            let endpoint = format!("/repos/{repo}/{path}/{number}");
            let state = if open { "open" } else { "closed" };
            rest(binary, "PATCH", &endpoint, &[("state", state)]).await?;
            Ok(Response::Done)
        }
        Action::Comment {
            repository,
            number,
            body,
            confirm,
        } => {
            let repo = owned(&repositories, &repository, number)?;
            confirmed(confirm)?;
            let body = body.trim();
            if body.is_empty() || body.len() > COMMENT_BODY_LIMIT || body.contains('\0') {
                return Err(Error::new(
                    "invalid",
                    "Comments must have 1 to 65,536 bytes of text.",
                ));
            }
            let endpoint = format!("/repos/{repo}/issues/{number}/comments");
            rest(binary, "POST", &endpoint, &[("body", body)]).await?;
            Ok(Response::Done)
        }
        Action::Create {
            session_id,
            title,
            body,
            draft,
            confirm,
        } => {
            confirmed(confirm)?;
            let title = title.trim().to_string();
            let body = body.trim().to_string();
            if title.is_empty() || title.chars().count() > 256 || title.contains('\0') {
                return Err(Error::new(
                    "invalid",
                    "The title must have 1 to 256 characters.",
                ));
            }
            if body.len() > COMMENT_BODY_LIMIT || body.contains('\0') {
                return Err(Error::new("invalid", "The description is too long."));
            }
            let probe = state.clone();
            let id = session_id.clone();
            let (cwd, context) = native_task(move || {
                let cwd = crate::commands::session_path(&probe, &id)?;
                let context = crate::pull_requests::inspect(cwd.clone())?;
                Ok((cwd, context))
            })
            .await?;
            let repo = context
                .repository
                .clone()
                .filter(|repo| repositories.iter().any(|item| &item.repository == repo))
                .ok_or_else(|| {
                    Error::new(
                        "invalid",
                        "This session has no GitHub origin of a saved project.",
                    )
                })?;
            let head = context
                .branch
                .clone()
                .ok_or_else(|| Error::git("cannot open a pull request from a detached HEAD"))?;
            let push_cwd = cwd.clone();
            native_task(move || crate::git::push(&push_cwd).map(|_| ())).await?;
            let base = rest_capture(
                binary,
                "GET",
                &format!("/repos/{repo}"),
                &[],
                ".default_branch",
            )
            .await?;
            if base.is_empty() || base == head {
                return Err(Error::new(
                    "invalid",
                    "This branch is the repository's default branch.",
                ));
            }
            let draft = if draft { "true" } else { "false" };
            let url = rest_capture(
                binary,
                "POST",
                &format!("/repos/{repo}/pulls"),
                &[
                    ("title", &title),
                    ("head", &head),
                    ("base", &base),
                    ("body", &body),
                    ("draft", draft),
                ],
                ".html_url",
            )
            .await?;
            if !url.starts_with("https://github.com/") {
                return Err(Error::new(
                    "github_unavailable",
                    "GitHub did not return the new pull request.",
                ));
            }
            Ok(Response::Created { url })
        }
    }
}

/// A fixed REST call whose one `--jq` field is returned (bounded, trimmed).
/// `draft` is sent as a typed boolean; every other field stays a string.
async fn rest_capture(
    binary: &OsStr,
    method: &str,
    endpoint: &str,
    fields: &[(&str, &str)],
    jq: &str,
) -> Result<String> {
    let mut command = hardened(binary);
    command.args([
        "api",
        "--hostname",
        "github.com",
        "--method",
        method,
        "-H",
        "Accept: application/vnd.github+json",
        endpoint,
        "--jq",
        jq,
    ]);
    for (key, value) in fields {
        let flag = if *key == "draft" { "-F" } else { "-f" };
        command.arg(flag).arg(format!("{key}={value}"));
    }
    let output = crate::cli_output::capture_command(command, Duration::from_secs(30))
        .await
        .map_err(|error| {
            lookup_error(if error.kind() == std::io::ErrorKind::NotFound {
                LookupStatus::CliMissing
            } else {
                LookupStatus::Unavailable
            })
        })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout)
            .trim()
            .chars()
            .take(400)
            .collect());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(if stderr.contains("A pull request already exists") {
        Error::new(
            "github_conflict",
            "A pull request already exists for this branch.",
        )
    } else if stderr.contains("HTTP 403") || stderr.contains("HTTP 404") {
        Error::new(
            "github_forbidden",
            "Your GitHub account cannot change this repository.",
        )
    } else if stderr.contains("HTTP 422") {
        Error::new(
            "github_invalid",
            "GitHub refused this pull request (is the branch pushed and different from the base?).",
        )
    } else {
        lookup_error(status_of(&output.stderr))
    })
}

fn confirmed(confirm: bool) -> Result<()> {
    if confirm {
        Ok(())
    } else {
        Err(Error::new(
            "confirmation_required",
            "Confirm this GitHub change first.",
        ))
    }
}

/// The repository must belong to a saved project; the number must be plausible.
fn owned<'a>(repositories: &'a [Repository], requested: &str, number: u32) -> Result<&'a str> {
    if number == 0 || number > 10_000_000 {
        return Err(Error::new(
            "invalid",
            "Invalid pull request or issue number.",
        ));
    }
    repositories
        .iter()
        .find(|repo| repo.repository.eq_ignore_ascii_case(requested))
        .map(|repo| repo.repository.as_str())
        .ok_or_else(|| Error::not_found("This repository is not one of your projects."))
}

/// GitHub repositories of saved projects, from each project's `origin` remote.
fn owned_repositories(state: &AppState) -> Result<Vec<Repository>> {
    let projects: Vec<(String, PathBuf)> = state
        .data
        .lock()
        .projects
        .iter()
        .map(|project| (project.id.clone(), PathBuf::from(&project.path)))
        .collect();
    let mut found: BTreeMap<String, Repository> = BTreeMap::new();
    for (id, path) in projects {
        let Ok(output) = crate::git::bounded_probe(&path, &["remote", "get-url", "origin"]) else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let Some(repo) =
            crate::git::normalize_github_web_url(String::from_utf8_lossy(&output.stdout).trim())
                .and_then(|url| repository(&url))
        else {
            continue;
        };
        let entry = found
            .entry(repo.to_ascii_lowercase())
            .or_insert_with(|| Repository {
                repository: repo.clone(),
                project_ids: vec![],
            });
        entry.project_ids.push(id);
        if found.len() >= MAX_REPOSITORIES {
            break;
        }
    }
    Ok(found.into_values().collect())
}

fn status_of(stderr: &[u8]) -> LookupStatus {
    let stderr = String::from_utf8_lossy(stderr);
    if stderr.contains("gh auth login") || stderr.contains("HTTP 401") {
        LookupStatus::AuthRequired
    } else {
        LookupStatus::Unavailable
    }
}

/// One fixed GraphQL document with typed variables. String values go through
/// `-f` (raw, never `@file`); integers through `-F`.
pub(crate) async fn graphql(
    binary: &OsStr,
    query: &str,
    strings: &[(&str, &str)],
    ints: &[(&str, u32)],
) -> std::result::Result<Value, LookupStatus> {
    let mut command = hardened(binary);
    command.args(["api", "graphql", "--hostname", "github.com", "-f"]);
    command.arg(format!("query={query}"));
    for (key, value) in strings {
        command.arg("-f").arg(format!("{key}={value}"));
    }
    for (key, value) in ints {
        command.arg("-F").arg(format!("{key}={value}"));
    }
    let output = crate::cli_output::capture_command(command, Duration::from_secs(20))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                LookupStatus::CliMissing
            } else {
                LookupStatus::Unavailable
            }
        })?;
    if !output.status.success() {
        return Err(status_of(&output.stderr));
    }
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| LookupStatus::Unavailable)?;
    if value.get("data").is_none_or(Value::is_null) {
        return Err(LookupStatus::Unavailable);
    }
    Ok(value["data"].clone())
}

pub(crate) fn lookup_error(status: LookupStatus) -> Error {
    match status {
        LookupStatus::CliMissing => Error::new(
            "gh_missing",
            "GitHub CLI (gh) is not installed. Install it and run `gh auth login`.",
        ),
        LookupStatus::AuthRequired => Error::new(
            "gh_auth",
            "GitHub CLI is not signed in. Run `gh auth login` in a terminal.",
        ),
        _ => Error::new("github_unavailable", "GitHub did not answer. Try again."),
    }
}

/// A fixed REST change. Never publishes raw output; maps refusals to short reasons.
async fn rest(binary: &OsStr, method: &str, endpoint: &str, fields: &[(&str, &str)]) -> Result<()> {
    let mut command = hardened(binary);
    command.args([
        "api",
        "--hostname",
        "github.com",
        "--method",
        method,
        "-H",
        "Accept: application/vnd.github+json",
        endpoint,
    ]);
    for (key, value) in fields {
        command.arg("-f").arg(format!("{key}={value}"));
    }
    let output = crate::cli_output::capture_command(command, Duration::from_secs(30))
        .await
        .map_err(|error| {
            lookup_error(if error.kind() == std::io::ErrorKind::NotFound {
                LookupStatus::CliMissing
            } else {
                LookupStatus::Unavailable
            })
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(if stderr.contains("HTTP 409") {
        Error::new(
            "github_conflict",
            "The pull request changed on GitHub. Refresh and review it again.",
        )
    } else if stderr.contains("HTTP 405") {
        Error::new(
            "github_refused",
            "GitHub cannot merge this pull request now (checks, reviews or conflicts).",
        )
    } else if stderr.contains("HTTP 403") || stderr.contains("HTTP 404") {
        Error::new(
            "github_forbidden",
            "Your GitHub account cannot change this repository.",
        )
    } else if stderr.contains("HTTP 422") {
        Error::new("github_invalid", "GitHub refused this change.")
    } else {
        lookup_error(status_of(&output.stderr))
    })
}

fn string(value: &Value, limit: usize) -> Option<String> {
    value
        .as_str()
        .map(|item| text(item, limit))
        .filter(|item| !item.is_empty())
}

/// Multi-line text (bodies, comments) keeps newlines and tabs only.
fn body(value: &Value, limit: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(limit)
        .collect()
}

fn login(value: &Value) -> Option<String> {
    string(&value["login"], 100)
}

fn count(value: &Value) -> u32 {
    value
        .as_u64()
        .map(|n| n.min(u32::MAX as u64) as u32)
        .unwrap_or(0)
}

fn nodes(value: &Value) -> &[Value] {
    value["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn labels(value: &Value) -> Vec<Label> {
    nodes(value)
        .iter()
        .filter_map(|label| {
            Some(Label {
                name: string(&label["name"], 80)?,
                color: label["color"]
                    .as_str()
                    .filter(|c| c.len() == 6 && c.bytes().all(|b| b.is_ascii_hexdigit()))
                    .map(str::to_owned),
            })
        })
        .collect()
}

fn item(node: &Value, repo: &str) -> Option<Item> {
    let kind = match node["__typename"].as_str() {
        Some("PullRequest") => ItemKind::PullRequest,
        Some("Issue") => ItemKind::Issue,
        _ => return None,
    };
    let number = count(&node["number"]);
    if number == 0 {
        return None;
    }
    let url = github_link(node["url"].as_str(), repo)?;
    let state = match node["state"].as_str() {
        Some("MERGED") => "merged",
        Some("CLOSED") => "closed",
        _ => "open",
    };
    let review_requests = nodes(&node["reviewRequests"])
        .iter()
        .filter_map(|request| login(&request["requestedReviewer"]))
        .collect();
    let checks = node["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]
        .as_str()
        .map(|state| text(state, 20));
    Some(Item {
        kind,
        repository: repo.to_owned(),
        number,
        title: string(&node["title"], TITLE_LIMIT).unwrap_or_default(),
        url,
        state: state.into(),
        is_draft: node["isDraft"].as_bool().unwrap_or(false),
        author: login(&node["author"]),
        created_at: string(&node["createdAt"], 40).unwrap_or_default(),
        updated_at: string(&node["updatedAt"], 40).unwrap_or_default(),
        head_ref: string(&node["headRefName"], 255),
        base_ref: string(&node["baseRefName"], 255),
        additions: count(&node["additions"]),
        deletions: count(&node["deletions"]),
        review_decision: string(&node["reviewDecision"], 40),
        mergeable: string(&node["mergeable"], 40),
        labels: labels(&node["labels"]),
        comment_count: count(&node["comments"]["totalCount"]),
        assignees: nodes(&node["assignees"]).iter().filter_map(login).collect(),
        review_requests,
        checks,
    })
}

const LIST_QUERY: &str = "query($q:String!,$first:Int!){viewer{login} search(query:$q,type:ISSUE,first:$first){nodes{__typename \
... on PullRequest{number title url state isDraft createdAt updatedAt headRefName baseRefName additions deletions reviewDecision mergeable author{login} labels(first:10){nodes{name color}} comments{totalCount} assignees(first:10){nodes{login}} reviewRequests(first:10){nodes{requestedReviewer{... on User{login}}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}} \
... on Issue{number title url state createdAt updatedAt author{login} labels(first:10){nodes{name color}} comments{totalCount} assignees(first:10){nodes{login}}}}}}";

fn search_query(repo: &str, kind: ItemKind, state: ItemState) -> String {
    let filter = match (kind, state) {
        (_, ItemState::Open) => "is:open",
        (ItemKind::PullRequest, ItemState::Closed) => "is:closed is:unmerged",
        (ItemKind::PullRequest, ItemState::Merged) => "is:merged",
        (ItemKind::Issue, _) => "is:closed",
    };
    format!(
        "repo:{repo} {} {filter} sort:updated-desc",
        if kind == ItemKind::PullRequest {
            "is:pr"
        } else {
            "is:issue"
        }
    )
}

async fn list(
    binary: &OsStr,
    repositories: Vec<Repository>,
    kind: ItemKind,
    state: ItemState,
) -> Inbox {
    let mut tasks = tokio::task::JoinSet::new();
    for (index, repo) in repositories.iter().enumerate() {
        let repo = repo.repository.clone();
        let binary = binary.to_owned();
        tasks.spawn(async move {
            let query = search_query(&repo, kind, state);
            let result = graphql(&binary, LIST_QUERY, &[("q", &query)], &[("first", PAGE)]).await;
            (index, repo, result)
        });
    }
    let mut results = Vec::new();
    while let Some(Ok(result)) = tasks.join_next().await {
        results.push(result);
    }
    results.sort_by_key(|(index, _, _)| *index);
    let mut inbox = Inbox {
        viewer: None,
        repositories,
        items: vec![],
        failures: vec![],
        checked_at: chrono::Utc::now().to_rfc3339(),
    };
    for (_, repo, result) in results {
        match result {
            Ok(data) => {
                inbox.viewer = inbox.viewer.or_else(|| login(&data["viewer"]));
                inbox.items.extend(
                    nodes(&data["search"])
                        .iter()
                        .filter_map(|node| item(node, &repo)),
                );
            }
            Err(status) => inbox.failures.push(Failure {
                repository: repo,
                status,
            }),
        }
    }
    inbox.items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    inbox
}

const PR_DETAIL_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number:$number){__typename \
number title url state isDraft body createdAt updatedAt mergedAt closedAt headRefName baseRefName headRefOid additions deletions changedFiles reviewDecision mergeable mergeStateStatus viewerCanUpdate author{login} \
labels(first:20){nodes{name color}} comments{totalCount} assignees(first:10){nodes{login}} reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{name}}}} \
reviews(last:30){nodes{author{login} state body submittedAt}} commentsList:comments(last:50){nodes{author{login} body createdAt}} \
commits(last:50){nodes{commit{oid messageHeadline committedDate author{name} statusCheckRollup{state contexts(first:80){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}}}}} \
files(first:100){totalCount nodes{path additions deletions changeType}}}}}";

const ISSUE_DETAIL_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){__typename \
number title url state body createdAt updatedAt closedAt viewerCanUpdate author{login} labels(first:20){nodes{name color}} comments{totalCount} assignees(first:10){nodes{login}} \
commentsList:comments(last:50){nodes{author{login} body createdAt}}}}}";

pub(crate) fn check_status(node: &Value) -> String {
    let value = match node["__typename"].as_str() {
        Some("CheckRun") => match (node["status"].as_str(), node["conclusion"].as_str()) {
            (Some("COMPLETED"), Some("SUCCESS")) => "passed",
            (Some("COMPLETED"), Some("NEUTRAL" | "SKIPPED")) => "skipped",
            (Some("COMPLETED"), Some(_)) => "failed",
            (Some(_), _) => "pending",
            _ => "unknown",
        },
        Some("StatusContext") => match node["state"].as_str() {
            Some("SUCCESS") => "passed",
            Some("FAILURE" | "ERROR") => "failed",
            Some("PENDING" | "EXPECTED") => "pending",
            _ => "unknown",
        },
        _ => "unknown",
    };
    value.into()
}

async fn detail(binary: &OsStr, repo: &str, number: u32, kind: ItemKind) -> Result<Detail> {
    let (owner, name) = repo.split_once('/').expect("validated repository");
    let query = if kind == ItemKind::PullRequest {
        PR_DETAIL_QUERY
    } else {
        ISSUE_DETAIL_QUERY
    };
    let data = graphql(
        binary,
        query,
        &[("owner", owner), ("name", name)],
        &[("number", number)],
    )
    .await
    .map_err(lookup_error)?;
    let repository = &data["repository"];
    let node = if kind == ItemKind::PullRequest {
        &repository["pullRequest"]
    } else {
        &repository["issue"]
    };
    let item = item(node, repo).ok_or_else(|| Error::not_found("Not found on GitHub."))?;
    let latest = node["commits"]["nodes"]
        .as_array()
        .and_then(|commits| commits.last())
        .cloned()
        .unwrap_or(Value::Null);
    let checks = nodes(&latest["commit"]["statusCheckRollup"]["contexts"])
        .iter()
        .filter_map(|check| {
            let repo_link = |field: &str| github_link(check[field].as_str(), repo);
            Some(Check {
                name: string(&check["name"], 200).or_else(|| string(&check["context"], 200))?,
                status: check_status(check),
                url: repo_link("detailsUrl").or_else(|| repo_link("targetUrl")),
            })
        })
        .collect();
    let mut merge_methods = vec![];
    for (field, method) in [
        ("squashMergeAllowed", MergeMethod::Squash),
        ("mergeCommitAllowed", MergeMethod::Merge),
        ("rebaseMergeAllowed", MergeMethod::Rebase),
    ] {
        if repository[field].as_bool().unwrap_or(false) {
            merge_methods.push(method);
        }
    }
    let files_total = count(&node["files"]["totalCount"]);
    let files: Vec<ChangedFile> = nodes(&node["files"])
        .iter()
        .filter_map(|file| {
            Some(ChangedFile {
                path: string(&file["path"], 1024)?,
                additions: count(&file["additions"]),
                deletions: count(&file["deletions"]),
                change_type: string(&file["changeType"], 20).unwrap_or_default(),
            })
        })
        .collect();
    Ok(Detail {
        body: body(&node["body"], BODY_LIMIT),
        head_oid: node["headRefOid"]
            .as_str()
            .filter(|oid| sha(oid))
            .map(str::to_ascii_lowercase),
        merged_at: string(&node["mergedAt"], 40),
        closed_at: string(&node["closedAt"], 40),
        merge_state_status: string(&node["mergeStateStatus"], 40),
        changed_files: count(&node["changedFiles"]),
        viewer_can_update: node["viewerCanUpdate"].as_bool().unwrap_or(false),
        merge_methods,
        checks,
        reviewers: nodes(&node["reviewRequests"])
            .iter()
            .filter_map(|request| {
                login(&request["requestedReviewer"])
                    .or_else(|| string(&request["requestedReviewer"]["name"], 100))
            })
            .collect(),
        reviews: nodes(&node["reviews"])
            .iter()
            .map(|review| Review {
                author: login(&review["author"]),
                state: string(&review["state"], 40).unwrap_or_default(),
                body: body(&review["body"], COMMENT_LIMIT),
                submitted_at: string(&review["submittedAt"], 40),
            })
            .collect(),
        comments: nodes(&node["commentsList"])
            .iter()
            .map(|comment| Comment {
                author: login(&comment["author"]),
                body: body(&comment["body"], COMMENT_LIMIT),
                created_at: string(&comment["createdAt"], 40).unwrap_or_default(),
            })
            .collect(),
        commits: nodes(&node["commits"])
            .iter()
            .filter_map(|commit| {
                let commit = &commit["commit"];
                Some(Commit {
                    oid: commit["oid"].as_str().filter(|oid| sha(oid))?.to_owned(),
                    headline: string(&commit["messageHeadline"], 300).unwrap_or_default(),
                    author: string(&commit["author"]["name"], 100),
                    committed_at: string(&commit["committedDate"], 40),
                })
            })
            .collect(),
        files_truncated: (files.len() as u32) < files_total,
        files,
        item,
    })
}

async fn diff(binary: &OsStr, repo: &str, number: u32) -> Result<(String, bool)> {
    let mut command = hardened(binary);
    command.args([
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "-H",
        "Accept: application/vnd.github.diff",
        &format!("/repos/{repo}/pulls/{number}"),
    ]);
    let output = crate::cli_output::capture_command(command, Duration::from_secs(30)).await;
    match output {
        Ok(output) if output.status.success() => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            let truncated = text.len() > DIFF_LIMIT;
            if truncated {
                let mut end = DIFF_LIMIT;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                text.truncate(end);
            }
            Ok((text, truncated))
        }
        // The capture refuses outputs over its own 2 MiB ceiling.
        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => Err(Error::new(
            "diff_too_large",
            "This diff is too large to show here. Open it on GitHub.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(lookup_error(LookupStatus::CliMissing))
        }
        Err(_) => Err(lookup_error(LookupStatus::Unavailable)),
        Ok(output) => Err(lookup_error(status_of(&output.stderr))),
    }
}

const FAILURES_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){commits(last:1){nodes{commit{statusCheckRollup{contexts(first:80){nodes{__typename \
... on CheckRun{databaseId name status conclusion detailsUrl title summary checkSuite{app{slug}} annotations(first:10){nodes{path message location{start{line}}}}} \
... on StatusContext{context state targetUrl description}}}}}}}}}}";

pub(crate) async fn failures(
    binary: &OsStr,
    repo: &str,
    number: u32,
) -> Result<(Vec<FailedCheck>, bool)> {
    let (owner, name) = repo.split_once('/').expect("validated repository");
    let data = graphql(
        binary,
        FAILURES_QUERY,
        &[("owner", owner), ("name", name)],
        &[("number", number)],
    )
    .await
    .map_err(lookup_error)?;
    let node = &data["repository"]["pullRequest"];
    if node.is_null() {
        return Err(Error::not_found("Not found on GitHub."));
    }
    let failed: Vec<&Value> =
        nodes(&node["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["contexts"])
            .iter()
            .filter(|check| check_status(check) == "failed")
            .collect();
    let truncated = failed.len() > MAX_FAILURES;
    let mut budget = LOG_BUDGET;
    let mut checks = vec![];
    for check in failed.into_iter().take(MAX_FAILURES) {
        let Some(name) = string(&check["name"], 200).or_else(|| string(&check["context"], 200))
        else {
            continue;
        };
        let summary = ["title", "summary", "description"]
            .iter()
            .filter_map(|field| {
                Some(body(&check[*field], 1_500).trim().to_owned()).filter(|v| !v.is_empty())
            })
            .collect::<Vec<_>>()
            .join("\n");
        let annotations = nodes(&check["annotations"])
            .iter()
            .filter_map(|note| {
                let message = string(&note["message"], 300)?;
                let path = string(&note["path"], 300).unwrap_or_default();
                Some(match note["location"]["start"]["line"].as_u64() {
                    Some(line) => format!("{path}:{line} {message}"),
                    None if path.is_empty() => message,
                    None => format!("{path} {message}"),
                })
            })
            .collect();
        // A GitHub Actions check run's database ID is its job ID.
        let job = (check["checkSuite"]["app"]["slug"].as_str() == Some("github-actions"))
            .then(|| check["databaseId"].as_u64())
            .flatten();
        let log = match job {
            Some(job) if budget > 0 => job_log(binary, repo, job)
                .await
                .map(|log| log_excerpt(&log, LOG_EXCERPT_LIMIT.min(budget)))
                .filter(|log| !log.is_empty()),
            _ => None,
        };
        budget = budget.saturating_sub(log.as_ref().map_or(0, String::len));
        checks.push(FailedCheck {
            url: github_link(check["detailsUrl"].as_str(), repo)
                .or_else(|| github_link(check["targetUrl"].as_str(), repo)),
            summary: Some(summary).filter(|s| !s.is_empty()),
            annotations,
            log,
            name,
        });
    }
    Ok((checks, truncated))
}

/// One Actions job log through a fixed GET (bounded by the 2 MiB capture ceiling).
async fn job_log(binary: &OsStr, repo: &str, job: u64) -> Option<String> {
    let mut command = hardened(binary);
    command.args([
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        &format!("/repos/{repo}/actions/jobs/{job}/logs"),
    ]);
    let output = crate::cli_output::capture_command(command, Duration::from_secs(20))
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Removes the timestamp prefix, ANSI colour codes and control characters of one log line.
fn clean_log_line(line: &str) -> String {
    let line = line.trim_start_matches('\u{feff}');
    let line = match line.split_once(' ') {
        Some((stamp, rest))
            if stamp.len() >= 20
                && stamp.ends_with('Z')
                && stamp.as_bytes()[4] == b'-'
                && stamp.as_bytes()[10] == b'T' =>
        {
            rest
        }
        _ => line,
    };
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
        } else if !ch.is_control() || ch == '\t' {
            out.push(ch);
        }
    }
    out.trim_end().to_owned()
}

fn is_error_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    line.contains("##[error]")
        || lower.starts_with("error")
        || lower.contains("error:")
        || lower.contains("error[")
        || line.contains("FAIL")
        || lower.contains("panicked at")
        || lower.contains("assertionerror")
        || line.contains('✕')
        || line.contains('✗')
}

/// The lines around each error marker plus the end of the log, at most `limit`
/// bytes (keeping the end, where the failure summary usually is).
fn log_excerpt(log: &str, limit: usize) -> String {
    let lines: Vec<String> = log
        .lines()
        .map(clean_log_line)
        .take_while(|line| {
            !line.starts_with("Post job cleanup") && line != "Cleaning up orphan processes"
        })
        .filter(|line| !line.is_empty() && line != "##[endgroup]")
        .collect();
    let mut keep = vec![false; lines.len()];
    for (index, line) in lines.iter().enumerate() {
        if is_error_line(line) {
            for slot in &mut keep[index.saturating_sub(15)..(index + 3).min(lines.len())] {
                *slot = true;
            }
        }
    }
    for slot in &mut keep[lines.len().saturating_sub(30)..] {
        *slot = true;
    }
    let mut out = String::new();
    let mut skipped = false;
    for (line, kept) in lines.iter().zip(keep) {
        if !kept {
            skipped = true;
            continue;
        }
        if skipped && !out.is_empty() {
            out.push_str("…\n");
        }
        skipped = false;
        out.push_str(line);
        out.push('\n');
    }
    if out.len() > limit {
        let mut start = out.len() - limit + "…\n".len();
        while !out.is_char_boundary(start) {
            start += 1;
        }
        out = format!("…\n{}", &out[start..]);
    }
    out.trim_end().to_owned()
}

const PR_ID_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id isDraft}}}";
const READY_MUTATION: &str = "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}";
const DRAFT_MUTATION: &str =
    "mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{isDraft}}}";

async fn set_draft(binary: &OsStr, repo: &str, number: u32, draft: bool) -> Result<()> {
    let (owner, name) = repo.split_once('/').expect("validated repository");
    let data = graphql(
        binary,
        PR_ID_QUERY,
        &[("owner", owner), ("name", name)],
        &[("number", number)],
    )
    .await
    .map_err(lookup_error)?;
    let node = &data["repository"]["pullRequest"];
    if node["isDraft"].as_bool() == Some(draft) {
        return Ok(());
    }
    let id = node["id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'='))
        })
        .ok_or_else(|| Error::not_found("Pull request not found on GitHub."))?;
    graphql(
        binary,
        if draft {
            DRAFT_MUTATION
        } else {
            READY_MUTATION
        },
        &[("id", id)],
        &[],
    )
    .await
    .map_err(|status| match status {
        LookupStatus::Unavailable => Error::new(
            "github_refused",
            "GitHub refused to change the draft state.",
        ),
        other => lookup_error(other),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn repos() -> Vec<Repository> {
        vec![Repository {
            repository: "owner/repo".into(),
            project_ids: vec!["p".into()],
        }]
    }

    #[test]
    fn only_owned_repositories_and_plausible_numbers_are_accepted() {
        let repos = repos();
        assert_eq!(owned(&repos, "Owner/Repo", 7).unwrap(), "owner/repo");
        assert!(owned(&repos, "other/repo", 7).is_err());
        assert!(owned(&repos, "owner/repo", 0).is_err());
        assert!(owned(&repos, "owner/repo", 20_000_000).is_err());
        assert!(confirmed(false).is_err() && confirmed(true).is_ok());
    }

    #[test]
    fn actions_are_closed_and_mutations_carry_confirmation() {
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"list","kind":"pullRequest","state":"open"}"#
        )
        .is_ok());
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"list","kind":"pullRequest","state":"open","query":"repo:x/y"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"merge","repository":"owner/repo","number":1,"method":"squash","expectedHead":"x"}"#
        )
        .is_err(), "confirm is required");
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"merge","repository":"owner/repo","number":1,"method":"octopus","expectedHead":"x","confirm":true}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"delete","repository":"owner/repo","number":1}"#
        )
        .is_err());
    }

    #[test]
    fn search_text_is_built_natively_from_validated_parts() {
        assert_eq!(
            search_query("owner/repo", ItemKind::PullRequest, ItemState::Open),
            "repo:owner/repo is:pr is:open sort:updated-desc"
        );
        assert_eq!(
            search_query("owner/repo", ItemKind::Issue, ItemState::Closed),
            "repo:owner/repo is:issue is:closed sort:updated-desc"
        );
        assert_eq!(
            search_query("owner/repo", ItemKind::PullRequest, ItemState::Closed),
            "repo:owner/repo is:pr is:closed is:unmerged sort:updated-desc"
        );
        assert_eq!(
            search_query("owner/repo", ItemKind::PullRequest, ItemState::Merged),
            "repo:owner/repo is:pr is:merged sort:updated-desc"
        );
    }

    #[test]
    fn items_keep_only_this_repository_links_and_bounded_text() {
        let node = json!({
            "__typename": "PullRequest", "number": 12, "title": "Fix\u{0007} it",
            "url": "https://github.com/owner/repo/pull/12", "state": "MERGED", "isDraft": false,
            "author": {"login": "ana"}, "createdAt": "t", "updatedAt": "u",
            "labels": {"nodes": [{"name": "bug", "color": "ff0000"}, {"name": "x", "color": "url(evil)"}]},
            "comments": {"totalCount": 3}, "assignees": {"nodes": [{"login": "bob"}]},
            "reviewRequests": {"nodes": [{"requestedReviewer": {"login": "me"}}]},
            "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "FAILURE"}}}]}
        });
        let parsed = item(&node, "owner/repo").unwrap();
        assert_eq!(parsed.title, "Fix it");
        assert_eq!(parsed.state, "merged");
        assert_eq!(parsed.labels[0].color.as_deref(), Some("ff0000"));
        assert_eq!(parsed.labels[1].color, None);
        assert_eq!(parsed.review_requests, vec!["me".to_string()]);
        assert_eq!(parsed.checks.as_deref(), Some("FAILURE"));
        let mut foreign = node.clone();
        foreign["url"] = json!("https://github.com/other/repo/pull/12");
        assert!(item(&foreign, "owner/repo").is_none());
        let mut evil = node;
        evil["url"] = json!("https://evil.example/owner/repo/pull/12");
        assert!(item(&evil, "owner/repo").is_none());
    }

    #[test]
    fn log_excerpts_keep_errors_and_the_end_without_noise() {
        let mut log = String::from("\u{feff}2026-09-30T15:08:56.0820715Z ##[group]Run npm test\n");
        for index in 0..200 {
            log.push_str(&format!(
                "2026-09-30T15:08:56.0820715Z \u{1b}[36;1mline {index}\u{1b}[0m\n"
            ));
        }
        log.push_str(
            "2026-09-30T15:09:02.7756340Z ##[error]checkout.spec.ts: expected 200, got 500\n",
        );
        log.push_str("2026-09-30T15:09:02.7921553Z Cleaning up orphan processes\n2026-09-30T15:09:02.7921553Z secret tail\n");
        let excerpt = log_excerpt(&log, LOG_EXCERPT_LIMIT);
        assert!(excerpt.contains("##[error]checkout.spec.ts: expected 200, got 500"));
        assert!(excerpt.contains("line 199") && !excerpt.contains("line 20\n"));
        assert!(
            !excerpt.contains('\u{1b}')
                && !excerpt.contains("2026-09-30T")
                && !excerpt.contains("secret tail")
        );
        let short = log_excerpt(&log, 200);
        assert!(short.len() <= 200 && short.starts_with('…') && short.ends_with("got 500"));
    }

    #[test]
    fn failures_action_takes_only_repository_and_number() {
        assert!(serde_json::from_value::<Action>(
            json!({"type":"failures","repository":"o/r","number":4})
        )
        .is_ok());
        assert!(serde_json::from_value::<Action>(
            json!({"type":"failures","repository":"o/r","number":4,"job":1})
        )
        .is_err());
    }

    #[test]
    fn check_states_are_closed_values() {
        assert_eq!(
            check_status(
                &json!({"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"})
            ),
            "passed"
        );
        assert_eq!(
            check_status(
                &json!({"__typename":"CheckRun","status":"COMPLETED","conclusion":"TIMED_OUT"})
            ),
            "failed"
        );
        assert_eq!(
            check_status(&json!({"__typename":"StatusContext","state":"PENDING"})),
            "pending"
        );
        assert_eq!(check_status(&json!({"__typename":"Other"})), "unknown");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn graphql_passes_values_as_raw_fields_and_reports_missing_cli() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("gh");
        let log = dir.path().join("argv");
        std::fs::write(
            &binary,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\necho '{{\"data\":{{\"viewer\":{{\"login\":\"me\"}}}}}}'\n",
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        let data = graphql(
            binary.as_os_str(),
            "query{viewer{login}}",
            &[("q", "@/etc/passwd")],
            &[("n", 3)],
        )
        .await
        .unwrap();
        assert_eq!(data["viewer"]["login"], "me");
        let argv = std::fs::read_to_string(&log).unwrap();
        assert!(
            argv.contains("-f\nq=@/etc/passwd\n"),
            "strings never use -F file expansion"
        );
        assert!(argv.contains("-F\nn=3\n"));
        assert!(argv.contains("--hostname\ngithub.com\n"));
        let missing = graphql(OsStr::new("/nonexistent/gh"), "query{x}", &[], &[]).await;
        assert_eq!(missing.unwrap_err(), LookupStatus::CliMissing);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rest_changes_use_fixed_argv_and_map_refusals() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("gh");
        let log = dir.path().join("argv");
        std::fs::write(
            &binary,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\ncase \"$*\" in *merge*) echo 'HTTP 409: Head branch was modified' >&2; exit 1;; esac\necho '{{}}'\n",
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        rest(
            binary.as_os_str(),
            "POST",
            "/repos/owner/repo/issues/7/comments",
            &[("body", "@/etc/passwd\nline two")],
        )
        .await
        .unwrap();
        let argv = std::fs::read_to_string(&log).unwrap();
        assert!(argv.starts_with("api\n--hostname\ngithub.com\n--method\nPOST\n"));
        assert!(argv.contains("-f\nbody=@/etc/passwd\nline two\n"), "{argv}");
        let refused = rest(
            binary.as_os_str(),
            "PUT",
            "/repos/owner/repo/pulls/7/merge",
            &[("merge_method", "squash")],
        )
        .await
        .unwrap_err();
        assert!(format!("{refused:?}").contains("github_conflict"));
    }

    /// Read-only queries against real GitHub through the local `gh` login.
    /// `LIVE_GH_REPO=owner/repo cargo test --lib live_ -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_read_only_queries_parse() {
        let repo = std::env::var("LIVE_GH_REPO").unwrap_or_else(|_| "cli/cli".into());
        let repos = vec![Repository {
            repository: repo.clone(),
            project_ids: vec!["p".into()],
        }];
        let binary = OsStr::new("gh");
        let mut first_pr = None;
        for kind in [ItemKind::PullRequest, ItemKind::Issue] {
            for state in [ItemState::Open, ItemState::Closed, ItemState::Merged] {
                let inbox = list(binary, repos.clone(), kind, state).await;
                assert!(
                    inbox.failures.is_empty(),
                    "{kind:?} {state:?}: {:?}",
                    inbox.failures
                );
                assert!(inbox.viewer.is_some());
                eprintln!("{kind:?} {state:?}: {} items", inbox.items.len());
                if kind == ItemKind::PullRequest && first_pr.is_none() {
                    first_pr = inbox.items.first().map(|item| item.number);
                }
                if let Some(item) = inbox.items.first() {
                    let detail = detail(binary, &repo, item.number, kind).await.unwrap();
                    eprintln!(
                        "  #{} {:?} checks={} reviews={} comments={} commits={} files={} methods={:?}",
                        detail.item.number,
                        detail.item.state,
                        detail.checks.len(),
                        detail.reviews.len(),
                        detail.comments.len(),
                        detail.commits.len(),
                        detail.files.len(),
                        detail.merge_methods
                    );
                }
            }
        }
        if let Some(number) = first_pr {
            match diff(binary, &repo, number).await {
                Ok((text, truncated)) => eprintln!(
                    "diff #{number}: {} bytes, truncated={truncated}",
                    text.len()
                ),
                Err(error) => eprintln!("diff #{number}: {error:?}"),
            }
        }
    }
}
