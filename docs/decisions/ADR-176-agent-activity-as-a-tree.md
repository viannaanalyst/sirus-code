# ADR-176: Agent activity as a tree

**Status:** Accepted (2026-10-28).

## Context

An agent's run of tool calls (commands, reads, edits, searches) folds into one group under a
sentence such as "Ran 5 commands". Open, the group was a plain indented list. It did not show that
the rows belong together, and an expanded row's output sat in the middle of an unrelated column.

Zeron (github.com/zeronsh/comet, MIT, `crates/ui/src/transcript.rs`) draws the same thing as a
tree: a trunk down the left, an elbow into every row. Three directions were mocked up outside the
repo and the owner chose "A, tree".

## Decision

- An open group (`ActivityTree` in `src/components/AgentActivity.tsx`) is a tree. The summary row is
  26px: a chevron, then the same sentence as before. The group icon is gone; the chevron is the
  disclosure and turns when open.
- Rows are 32px tall with no gap, each wrapped in a `.tl-node` that owns its connector, so the trunk
  keeps running beside an expanded output block. Geometry follows Zeron: trunk at x 12.5px, a
  rounded elbow (radius 7px) to x 28px, a 4px break, a 16px icon at x 32px, 8px to the label. The
  trunk stops at the last row's elbow. The step still running joins the tree as its last row and
  its icon takes the accent.
- Finish (after the owner compared a mockup with Zeron): 12px text on an 18px line. The action name
  ("Run", "Read", "Edited", "Thought process") is muted, the detail (command, path) is primary text at 85%
  in the proportional font (`splitAroundDetail`), one line with an ellipsis; the full text and output
  stay in the row's expanded detail. The trunk and elbows are 1px (radius 6) in `--tree-line`
  (`oklch(1 0 0 / .12)` in dark, a matching violet-grey in light). The summary's 14px chevron is centred on
  the trunk (x 12.5) and its text is 12px muted. The running row's icon takes the accent. A failed row
  tints only its action name with `--danger` (plus a screen-reader "failed"); there is no red row and no cross.
- Motion: a new row reveals in 360ms (ease-out-expo, opacity and a 4px rise) and its elbow draws
  in 480ms (ease-out-quint, a clip-path wipe). The first row waits 90ms and rows arriving together
  stagger by 65ms (capped at 8 steps). While the group is active its summary carries a 3.4s linear
  light sweep; it is static when the group is done, the window rests (`data-ambient="off"`),
  animations are off or reduced motion is on.
- Only live arrivals animate. `ActivityTree` records the ids present on its first pass as still;
  afterwards an id it has not seen reveals only while the turn is active (`assignReveals`,
  `src/lib/tree-reveal.ts`). Opening a group, loading a transcript or finishing a turn shows the
  final state, and a row keeps its delay across re-renders so an entrance is never cut or replayed.
- Live behaviour, as Zeron does it. While a turn works, its current group of steps is open as the tree:
  each new step arrives as a branch and the one in progress is the last row. Nothing renders as a
  standalone line outside the tree any more (the running step's line, a failed command's red row and
  the "Editing files..." line used to). When the work settles (the agent writes reply text after the
  group, or the turn ends) the group collapses by default to its one-line summary, whose red failed
  count still says a step failed. The person's own open or close always wins
  (`workIsLive` and `groupExpanded` in `src/lib/turn-timeline.ts`). A live group shows its tree even
  with one step; a settled group of one step stays a flat line. A row's output chevron moved to the
  right edge and shows on hover or focus (always on touch screens). Earlier text and groups still fold
  behind "N previous messages" as before (`liveFoldBoundary`).
- Behaviour is otherwise unchanged: expand and collapse of each row's output, subagent cards (kept as separate cards under the tree, as
  Zeron does), approvals, masking, keyboard and screen-reader semantics (`aria-expanded`,
  `aria-controls`), virtualization and the phone layout, which uses the same component.

## Consequences

- An open group now reads as one structure, and long output no longer breaks the rail.
- A group with a single settled row stays a flat line; only groups with a summary, or live ones, draw a tree.
- A failed step inside a closed group is no longer repeated outside it; the summary's failed count and one click show it.
- The tree adds two pseudo-elements per row; they are static, so the cost is negligible next to the
  rows themselves.
- "Edited path +n −m" is not shown: an activity row carries no line counts, only its path. Adding
  them needs the native side to report them.
- Geometry and motion constants are credited to Zeron (MIT). No code was copied.
