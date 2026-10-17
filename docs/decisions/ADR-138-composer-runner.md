# ADR-138: Composer runner

- Status: accepted
- Date: 2026-10-17

## Context

While an agent worked, a soft light travelled the composer's border (`composer-working-light`). It said "busy" but not who was busy. MonoCode shows a pixel mascot running along its composer's top edge (its "composer runner"); the owner wanted the same idea with the mark of the model actually working, and chose it over a comet trail and a resting mark in a preview, without the smoke puffs, after rejecting pixel-art versions of the marks.

## Decision

- **The working model's own mark runs the top edge.** `ComposerRunner` draws the mark `resolveModelBrand` picks for the composer's model, the same one the model picker shows: OpenCode running DeepSeek runs the DeepSeek whale, Codex the OpenAI mark. It replaces the travelling light.
- **Motion** (`src/lib/composer-runner.ts`, pure): 20 px, small hops at 6.5 steps a second that land slightly squashed, a lean toward the direction of travel instead of mirroring (marks with letters would read backwards), a turn at each end and a high jump every few seconds. When the turn ends it takes one last jump and fades; it stays mounted through that exit. Appearance's `composerLineSpeed` (slow, smooth, fast) now sets its pace; the stored key is unchanged.
- **The background tasks pill is a platform.** When "N em segundo plano" (or its open panel) rests on the edge, the runner leaps onto it, runs across its top and leaps off the other side (chosen in a second preview over passing through, jumping over it or turning before it). Its box is read a few times a second, never per frame.
- **Cost.** One `requestAnimationFrame` loop writes only `transform` and `opacity` on one element; the edge's length is read by a `ResizeObserver`, not per frame. It pauses with the other ambient loops (window focus, visible document, Settings closed); reduced motion parks the mark at the edge's start. The phone's pill keeps none (ADR-129).

## Consequences

- The busy signal now says which model works, which matters most in split panes and with several providers.
- No smoke puffs or pixel sprites; both were tried in the preview and dropped.
