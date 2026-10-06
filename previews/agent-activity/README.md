# Agent activity design previews

Run `node previews/agent-activity/server.mjs`, then open **http://localhost:4178/**.
The server binds only loopback and serves a fixed list of preview files. All
fonts/icons are local; no third-party assets or native calls are used. Run
`node previews/agent-activity/verify.mjs` for virtual DOM interaction smoke checks.

Three proposed layouts: **Line**, **Trail**, **Panel**. Three independent
tooltip styles: **Micro**, **Shortcut**, **Context**, shown in Dark, Light and
neutral Translucent materials. The translucent backdrop is a CSS simulation;
buttons and labels remain readable with independent material tokens.

Scenarios cover running work, two-step questions (offered choices + custom text),
one-request command permission, success, failure and Stop. The active-work clock
pauses for input and freezes on termination; no timeout or automatic question
answer is inferred. Tool groups, two child-agent histories and a child detail
dialog are simulated. Favorite choices remain browser-local.

## Current product and references

- Sirus Code [`SessionPane.tsx`](../../src/components/SessionPane.tsx) currently
  renders text/code output, streaming placeholders and requests above the
  composer. [`AgentRequests.tsx`](../../src/components/AgentRequests.tsx) already
  handles typed, native-owned questions and one-request approvals. Session/Message
  types do not yet carry structured per-turn tool/subagent timelines.
- MonoCode inspected locally: `src/features/sessions/ui/AgentTranscript.tsx`
  (`LiveFoldTitle`, `SubagentPanel`, `useElapsedFrom`, `formatWorkingDuration`),
  `model/transcriptActivity.ts`, and `ui/QuestionForm.tsx`. It keeps model/work
  duration on a fold line, groups work, shows child-agent steps/reports, and pauses
  the work clock for approval/input. Its optional question auto-resolution is
  deliberately excluded from these proposals.
- Synara inspected locally: `apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx`,
  `ComposerSubagentStrip.tsx`, `UserInputQuestionForm.tsx`,
  `apps/web/src/lib/subagentPresentation.ts`, `packages/shared/src/subagents.ts`.
  Subagents carry native child/thread identities and provider/model/status hints;
  presentation links child conversations rather than inferring agents from prose.

Product adoption remains a later user choice. It would require native bounded
turn/tool/subagent events, lifecycle identity, actual timestamps/status, validated
child ownership and existing callback response gates (ADR-009/010/011). It must
not fabricate runtime stages from assistant text, claim a timeout without a
native deadline, expose hidden reasoning, or treat preview clicks as permission.

Validation: JavaScript syntax, virtual DOM workflow checks and local HTTP asset
responses. Browser UI automation was unavailable in this session; these checks
do not substitute for a rendered screenshot or real provider integration.
