# Discreet activity line and shortcut tooltips

Approved design: interactive preview Line 01 and Shortcut tooltip. Implement in place; this checkout has no Git metadata.

Architecture: optional native-owned `Message.activity` on the admitted assistant response stores immutable provider/model choice, native start/end/pause timestamps, and at most 128 observed tool/child records. Reuse existing `session-updated` snapshots and response IPC. No raw protocol inputs, hidden reasoning, child control, inferred completion or new permissions.

- [x] Native module `activity.rs`: closed data model, bounded observations, pause/finalization/recovery. Codex scoped thread/turn items, Claude top-level tool/task frames, OpenCode scoped ACP tool updates. Unsupported adapters retain truthful model/time/status only.
- [x] Frontend `AgentActivity.tsx` and elapsed helper: one compact model line, paused waiting caption, grouped tools and observed child details. Timer only for visible active line; no provider polling. Preserve transcript, pins and message actions.
- [x] Restyle existing `AgentRequests` with question progress, explicit Continue/Back/Send and original approval actions; keep generation-bound one-shot native responses.
- [x] Apply selected Atalho bubble to shared Arc tooltip, using theme tokens and bounded keyboard chips; preserve opted-out tooltips.
- [x] Test native observations and lifecycle (dedupe, bounds, no fabricated successful tools), elapsed calculations, question validation and SSR. Run required frontend/native checks and signed build. Review boundary and incrementally update Graphify; record behavior in ADR-035.

Validation: 134 frontend tests, 198 native tests (17 explicit live-provider tests ignored), 100/100 Arc renders, localized activity SSR, typecheck, lint, cargo fmt, production and locally signed desktop builds passed. Native Clippy with `-D warnings` was attempted and remains blocked by the concurrent browser debug helper (`src-tauri/src/browser.rs`, unused helper and unnecessary unsafe), outside this change. No real-provider run or UI screenshot was claimed. Graphify updated incrementally.
