# ADR-051: Scheduled automations start agent turns

**Status:** Accepted

## Context

Until now every agent turn started from an explicit Send. Goals never continue on their own (ADR-041), queued requests advance only after an explicit submit (ADR-042), and restored drafts never send. The rule was a conservative default: an unattended turn can edit files, run commands and use quota while nobody is watching. That raises the stakes of prompt injection from project content.

The owner asked for Automations like Synara and MonoCode. Both start agent runs on a schedule while the app is open:

- **Synara:** a server-side scheduler. Defaults to approval-required and a worktree, requires risk acknowledgments, stops after 3 consecutive failures and caps a run at 1 h.
- **MonoCode:** hourly, daily, weekday and weekly triggers, launched by the app when due, with the last 100 runs kept.

The owner removed the "explicit Send only" rule for this feature.

## Decision

An **automation** has a name, a prompt (≤64 KiB), a saved project, a provider and optional model, an approval profile, an optional planning (read-only) flag, a workspace (new isolated worktree by default, or the project checkout), a schedule and an enabled flag. Automations persist in `AppData.automations` (at most 50). Each one keeps a bounded run history (`AppData.automation_runs`, 50 per automation).

Schedules are a closed enum:

- `manual`, `once` (future instant);
- `hourly` (minute), `daily` / `weekdays` (HH:MM), `weekly` (weekday + HH:MM), in local time;
- `interval` (15 min to 7 days).

There is no free-form cron.

**Running.**

- **Timer:** one native timer, `automations::start`, sleeps until the earliest next run (re-reading the clock at most hourly) or until a definition changes. It runs only while Switchyard is open. This is a timer to a known instant, not a polling loop.
- **Each run:** a due run creates a normal session with `create_session_locked` and admits its first turn through the same `send_prompt` path as the Send button, so every native validation and approval rule applies. The run uses the automation's typed approval profile.
  - **Ask (the default):** tool approvals wait for the person, and the run stays paused until they answer.
  - **Full:** requires `acknowledgeFullAccess` on every save and cannot combine with planning.
- **Visibility:** run sessions appear in the sidebar like any session and trigger the usual notifications.

**Safety rules.**

- **Overlap:** a run is skipped if the previous run of the same automation is still active.
- **Repeated failures:** after 3 consecutive failed runs the automation pauses itself and shows why.
- **Missed runs:** runs missed while the app was closed start once if they are under 60 minutes late. Older ones are recorded as missed and rescheduled, so opening the app never starts a burst of runs.
- **Run now:** starts one run on demand, even when the automation is paused.
- **Project removal:** removing a project removes its automations. Deleting an automation keeps its past sessions.

**IPC security review.**

- **Command:** one closed command, `automation_action` (`list`, `upsert`, `delete`, `setEnabled`, `runNow`), with `deny_unknown_fields`.
- **Validation:**
  - names are printable and ≤200 characters;
  - prompts are 1–64 KiB without NUL;
  - the project must exist and the provider must be enabled;
  - model IDs are a bounded charset that cannot look like a flag;
  - schedules come from the closed enum.
- **No new surface:** renderer input never names a path, argv, flag or command. No new process kind, capability or credential access is added. Process spawn stays in the existing provider adapters.
- **Event:** one payload-free event, `automations-changed`, tells the renderer to refresh. The renderer also adopts native-created sessions it learns about from `session-updated`.

## Consequences

- **Positive:**
  - Recurring work (triage, dependency checks, summaries) runs on its own, in isolated worktrees, under the same approval rules as manual turns.
- **Negative:**
  - Agents can now act without a fresh click.
  - With Auto or Full, a run can edit files and use quota while nobody is watching.
  - The project checkout option shares the person's working copy.
- **Accepted trade-off:** runs only happen while the app is open. A schedule is not a guarantee: sleep, quitting or misses older than 60 minutes skip runs.

## Alternatives considered

- **Keeping explicit-Send only and offering reminders.** Rejected by the owner.
- **A background daemon or launch agent so runs happen with the app closed.** Rejected for now: it adds a long-lived process and a new trust boundary.
- **Free-form cron (Synara).** Deferred. The closed schedules cover the common cases and validate trivially.
- **Agent-created automations (Synara proposals).** Deferred. Only the person creates automations.
