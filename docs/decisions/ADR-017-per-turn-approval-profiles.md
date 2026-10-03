# ADR-017: Approval profiles are typed per-turn execution preferences

**Status:** Accepted. Supersedes the fixed-permission restrictions in ADR-003, ADR-009, ADR-010, ADR-011 and ADR-012; their identity, callback and lifecycle rules remain accepted.

## Context

The owner requested functional Request approval, Auto-review and Full access choices. A disabled informational menu cannot satisfy that request. The installed CLIs expose different permission mechanisms; a common label must not imply a common sandbox or manufacture support for an unverified adapter.

## Decision

`ExecutionOptions.approval` accepts only `ask`, `auto` or `full` through the existing `send_prompt` operation. Rust validates provider support and rejects Full combined with planning before process admission. There is no generic argv, configuration, permission-amendment or protocol IPC. Missing approval retains the restrictive adapter default.

| Adapter | Request approval | Auto-review | Full access |
| --- | --- | --- | --- |
| Codex | Workspace-write, on-request, user reviewer | Same sandbox, native auto_review reviewer | danger-full-access, never |
| Claude | manual host permissions | Native auto classifier | Native bypassPermissions |
| OpenCode | Workspace file callbacks; other adapter restrictions retained | File edits allowed; shell/network/external-directory restrictions retained | Child-only permission allow at global and build/plan agent/mode layers |
| Cursor | Unsupported machine-response protocol | Existing Auto-review and enabled sandbox | Fixed --force and disabled sandbox; explicit vendor deny rules remain |
| Grok | Vendor managed | Unverified; unavailable | Unverified; unavailable |

Codex confirms the requested thread sandbox and approval profile before input; every turn explicitly writes its sandbox, approval policy and reviewer so exact resume cannot silently retain Full. Claude starts each process with the selected permission mode and requires a successful fixed `set_permission_mode` acknowledgement for Auto/Full before sending user input. OpenCode regenerates child-only permission configuration for every process; no vendor files are modified. Unsupported host callbacks and secret/auth/config requests remain denied in every profile. Full is a vendor execution profile, not a guarantee that managed deny rules or unsupported tools disappear.

Composer selections are memory-only, scoped to draft owner and provider in the existing store. Successful sends preserve the selected profile while clearing one-turn references and planning. Restart does not promote the Session's last-admitted execution profile into a new composer default. Settings reject approval grants in model defaults. Enabling planning replaces remembered Full selections with restrictive supported profiles; completing a plan never silently restores Full. Explicitly selecting Full exits planning. The orange trigger exposes the current choice before Send.

CLI stderr remains native System messages, excluded from model context and displayed in the context panel's diagnostics tab. Actual turn failures remain visible in the conversation. Hiding diagnostics from the transcript does not discard them or declare a failed turn successful.

## Verification and limits

The installed Codex app-server schema verifies profile and per-turn reset fields. Native regression fixtures cover Codex restoration, Claude acknowledgement before input and rejection without input, OpenCode policy layers, Cursor argv separation and unsupported mode rejection. Frontend regressions cover owner/provider selection retention and planning normalization. Full-profile inference and every vendor model/managed-policy combination have not been exercised; these checks do not claim universal tool access or OS isolation. Runtime observations belong in the provider execution guide.

Primary references: [Claude permission modes](https://code.claude.com/docs/en/permission-modes), [Claude native control implementation](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py), [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters), [OpenCode permissions](https://opencode.ai/docs/permissions/) and [Codex app-server](https://developers.openai.com/codex/app-server).

## Consequences

- **Positive:** the selected mode drives verified native controls, and restrictive defaults can be restored explicitly on the next turn.
- **Negative:** Full broadens native agent tool authority; OpenCode Auto-review is limited to file edits and Cursor cannot offer manual host decisions.
- **Accepted trade-off:** provider-specific support and explicit per-turn profiles are preferable to a cosmetic menu or an unrestricted generic configuration channel.

## Alternatives considered

A globally persisted Full default, renderer-generated CLI settings, arbitrary protocol forwarding and fake uniform provider support were rejected. Keeping Full disabled was rejected by the owner's explicit feature request.
