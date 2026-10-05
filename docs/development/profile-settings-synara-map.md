# Synara Profile mapping

Status: removed on 2026-10-05 at the owner's request (see ADR-032, superseded). Kept as a historical reference.
Historical token telemetry and a lifetime activity ledger remain unavailable.
Reference inspected in the local Synara checkout on 2026-10-02.

## Reference behavior

Synara's Profile is a local identity and activity dashboard, not an app login.
[ProfileSettingsPanel](../../../synara/apps/web/src/components/settings/ProfileSettingsPanel.tsx)
renders two independently cached RPC results: core activity and token telemetry.
[Query options](../../../synara/apps/web/src/lib/serverReactQuery.ts) use a
one-minute core cache and five-minute token cache; neither refetches on window
focus. Core failure offers Retry. Token absence falls back to prompt activity
and turn-based provider/model rankings instead of estimating tokens.

| Surface | Verified Synara behavior |
| --- | --- |
| Identity | Centered 64 px avatar, editable name and @handle, small Synara badge; defaults derive from the native home-directory basename |
| Edit | Dialog keeps drafts until Save; name, handle, avatar color and photo are local preferences, separate from provider authentication |
| Photo | Picked image is cropped/compressed locally to a 160 px square JPEG with a 200,000-character encoded bound |
| Summary | Lifetime tokens, peak-day tokens, total prompts, current streak and longest streak |
| Activity | Rolling 274-day heatmap, seven weekday rows, responsive weekly columns, 3 px gaps and 5 px page-cell radius; month names below |
| Heatmap basis | Tokens when recorded; prompts otherwise. Four positive intensity levels rank active days by their distribution, rather than by the largest day |
| Insights | Most-used provider and reasoning, most-active local hour, most-worked project, skill counts and total threads |
| Plugins | Most-used skills/agents by recorded runs; honest empty state when none are recorded |
| Models | Top six model shares, original provider icons and thin progress bars; token basis preferred, turn basis otherwise |
| Share | Explicit dialog previews an activity card; local PNG export/copy and explicit X/LinkedIn/Reddit composer actions |

Source details:

- [Shared selectors](../../../synara/apps/web/src/components/profile/profileSelectors.ts)
  choose the metric consistently and disclose providers without token coverage.
- [Stats contract](../../../synara/packages/contracts/src/stats.ts) and
  [native stats query](../../../synara/apps/server/src/profileStats.ts) define
  actual prompt, turn and token aggregation. Prompt activity counts native
  user-dispatched messages, not imported message history. Model attribution
  uses the model each turn actually ran with. Dates/hours use the supplied local
  UTC offset. Token values use recorded positive deltas with provider-specific
  Claude accounting, not prompt text length or quota percentages.
- [Deletion archive](../../../synara/apps/server/src/profileStatsArchive.ts)
  preserves work in aggregates before purging a thread. Profile totals therefore
  remain lifetime totals after metadata deletion.
- [Edit dialog](../../../synara/apps/web/src/components/profile/EditProfileDialog.tsx),
  [name](../../../synara/apps/web/src/components/profile/useProfileName.ts),
  [handle](../../../synara/apps/web/src/components/profile/useProfileHandle.ts),
  [color](../../../synara/apps/web/src/components/profile/useProfileAvatarColor.ts)
  and [image processing](../../../synara/apps/web/src/components/profile/avatarImage.ts)
  supply local identity editing.
- [Share dialog](../../../synara/apps/web/src/components/profile/ShareDialog.tsx)
  and [export helper](../../../synara/apps/web/src/components/profile/shareCardExport.ts)
  implement the optional export flow.

## Switchyard data availability

The [settings sections](../../src/lib/settings.ts) include Profile beside General.
[Message and Session](../../src/client/types.ts) retain transcript timestamps and
the current session provider/model/execution choice, not an immutable per-turn
activity record. Provider usage snapshots contain quota percentages/reset windows
and account metadata, not lifetime token totals. `HostInfo.profileDefaultName` supplies only a local home basename;
`GitIdentity` describes repository state, not a person's identity.

| Desired metric | Existing source and practical limit |
| --- | --- |
| Total sessions/projects | Can count retained native metadata, including archived sessions; deleted metadata is absent, so this is not a lifetime count |
| Prompts/day, streaks, peak hour, busiest project | Transcript timestamps provide retained-message activity. Exact app-sent totals require provenance: imports contain external history and forks copy prior user messages with new message IDs |
| Provider/model shares | Current session selections support a clearly labelled session distribution. They cannot prove which model/provider ran every historical message after a selection changed |
| Reasoning shares | `Session.execution` is the last admitted choice, not historical per-turn execution |
| Lifetime tokens/peak token day | Unavailable. Do not derive from quota, text length or provider account limits |
| Skills/plugin usage | No structured run-count source for this page; catalog availability is not usage |
| Local identity | Persisted `AppSettings.profile` uses bounded native save/load and a separate native default-name field; vendor account identity is not reused |

See [ADR-005](../decisions/ADR-005-local-json-persistence.md),
[ADR-016](../decisions/ADR-016-transcript-forks-and-message-pins.md),
[ADR-021](../decisions/ADR-021-provider-conversation-import.md) and
[ADR-029](../decisions/ADR-029-sidebar-organization.md) for existing persistence,
copied transcripts, imports and archived-session boundaries. The quota boundary
is documented in [ADR-013](../decisions/ADR-013-provider-usage-and-earned-resets.md).

## Implemented adaptation

Keep the existing settings sidebar, content width, `ui-*` typography, soft
surfaces, borders and shared buttons. Profile appears beside General. Use a compact
centered identity header with a satin-silver default avatar, an Edit action and
local name/handle preferences. Reuse the Arc dialog/input primitives; preserve
keyboard focus, accessible labels and reduced-motion behavior. Do not add hover
tooltips to these controls.

The page shows retained session/project counts and clearly
labelled retained transcript activity, excluding fork-inherited prefixes and
external imports from app-sent prompt counts. A future native activity ledger
is required for Synara-equivalent lifetime totals, immutable turn attribution
and retention after deletion. Aggregate only dates/counts/provider/model/effort
from native admitted turns; keep prompt content, paths and credentials out of
the ledger. Its persistence and removal semantics need a dedicated design before
implementation, within the existing Client/Transport boundary and JSON storage.

Token metrics show unavailable and plugin usage is explicitly untracked.
Sharing previews the exact PNG used for native Copy/Save and the three fixed
social composer actions. Counts replace unavailable tokens in the export card.
No browser fallback or generic URL allowlist extension is used. The calendar
refreshes at local midnight and on focus/resume without polling. Native image
decoding, destination validation and local preferences follow
[ADR-032](../decisions/ADR-032-local-profile-and-activity-export.md).
