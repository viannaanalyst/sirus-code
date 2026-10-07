# ADR-074: Send and new thread, compact and send, new project from a name, CLI install choice

**Status:** Accepted (2026-10-07). Ideas taken from T3 Code (#15050, #16631, #14527) and MonoCode (#407).

## Decision

- **Send and start new thread (⌥⌘↩).** A customizable `send-new-thread` binding, handled by the composer itself, sends exactly like Enter (queue and steering rules included) and, once the message is admitted, opens the new-thread landing for the same project (like ⌘N). The Send tooltip shows it below Send. Shortcut validation (renderer and `models.rs`) now accepts `enter` as a key, but never plain ⌘↩, which stays the queue/steer inversion of ADR-062.
- **Compact and send.** For Codex and Claude sessions with a native thread (the providers that compact on `/compact`, ADR-057), when the reported context is at least 100k tokens or 70% of a known window and the last activity is more than 70 minutes old, the send button reads "Compact and send". Sending calls `send_prompt` with `/compact` directly (so the draft and its attachments stay put), waits until the store sees that turn start or finish (at most 5 s), then sends the request through the normal path, which queues it behind the running compaction (ADR-042): it goes out on the compaction's successful settlement, and a failed compaction pauses the queue as usual. Shift-click, or the small plain send beside it, skips compaction. Seventy minutes is past the providers' prompt-cache lifetime, when a resend of a long context costs the most.
- **New project from a name.** "Create new project…" (Activity add menu, project switcher, landing project menu, command palette) asks for a name and a parent folder (default `~/Projetos`; the last one used is kept in local storage). `create_project(name, parent)` (`new_project.rs`) never takes a folder name from the renderer: it derives `<parent>/<slug>` from the name (lowercase ASCII, digits and dashes, Portuguese accents folded, ≤64 characters). The parent must be absolute or `~`-relative, without `..`, and is created only inside the home folder. An existing non-empty folder is refused; an empty one is reused. It then runs `git init`, writes `README.md` (`# <name>`), and commits it as "Initial commit" with the person's Git identity, through the guarded native Git runner (hooks off, configured hooks and filters refused, 10 s bound). On failure it removes only what it created. The project is added under the typed name and a new thread opens there.
- **Choose the CLI install per provider.** `detect_agents` also lists every executable of each provider found in the CLI search path and the usual user install folders (`AgentInstall.candidates`, deduplicated by resolved file, at most 8, each probed for `--version`). Settings → Providers shows the executable in use under each provider and a menu with the installs found, "Choose file…" (the existing `pick_executable`, then `probe_provider` must answer before it is used) and "Use automatic". The choice is the existing `providerPaths` override; `save_settings` now refuses overrides that are neither absolute paths nor bare command names, and detection reruns after a change.

## Consequences

- **Positive:** fewer steps for common moves (send then start fresh, start a repo, switch between a Homebrew and an npm install), and long idle conversations come back cheaper.
- **Negative:** compact-and-send adds a compaction turn the person did not type; the label and tooltip say so, and Shift-click opts out. Candidate probes run one `--version` per extra install on each detection.
- **Security:** `create_project` is the only new command. It writes only inside a slug folder it creates (or an empty one), runs fixed Git argv, and never runs project code. Provider overrides were already settable; they are now validated natively.

## Alternatives considered

- **Compaction triggered on a timer.** Rejected: turns start from an explicit Send (only automations are exempt, ADR-051).
- **Sending the request as part of the `/compact` turn.** Rejected: providers treat `/compact` as a standalone command; the queue already has the right settle/failure semantics.
- **Letting the renderer pass the new folder path.** Rejected: a slug from the name keeps path segments out of IPC.
