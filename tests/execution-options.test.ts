import test from "node:test";
import assert from "node:assert/strict";
import { modelExecutionControls, offeredCursorVariant, supportsPlanning } from "../src/lib/execution-options.ts";
import { composerPlanning, composerPrompt } from "../src/lib/composer-context.ts";
import type { DiscoveredModel } from "../src/client/types.ts";
const models: DiscoveredModel[] = [
  { id: "claude-opus-5-medium", displayName: "Claude Opus 5 1M Medium", availability: "available" },
  { id: "claude-opus-5-high", displayName: "Claude Opus 5 1M", availability: "available" },
  { id: "claude-opus-5-high-fast", displayName: "Claude Opus 5 1M Fast", availability: "available" },
  { id: "claude-opus-5-thinking-high", displayName: "Claude Opus 5 1M Thinking", availability: "available" },
  { id: "claude-opus-5-thinking-high-fast", displayName: "Claude Opus 5 1M Thinking Fast", availability: "available" },
  { id: "claude-opus-5-max", displayName: "Claude Opus 5 1M Max", availability: "unavailable" },
  { id: "claude-sonnet-5-high-fast", displayName: "Claude Sonnet 5 1M Fast", availability: "available" },
];
test("planning replaces full access selections so ending a plan cannot silently restore them", () => {
  const context = { attachments: [], goal: "", planning: false, approvalByProvider: { codex: "full", cursor: "full", claude: "auto" } } as const;
  const plan = composerPlanning({ ...context, attachments: [] }, true);
  assert.deepEqual(plan.approvalByProvider, { codex: "ask", cursor: "auto", claude: "auto" });
  assert.deepEqual(composerPlanning(plan, false).approvalByProvider, plan.approvalByProvider);
  assert.equal(context.approvalByProvider.codex, "full");
});
test("approval controls offer only modes supported by the native provider adapter", async () => {
  const { providerById } = await import("../src/lib/provider-registry.ts");
  for (const provider of ["codex", "claude", "opencode"] as const) {
    assert.deepEqual(Reflect.get(providerById(provider), "approvalModes"), ["ask", "auto", "full"]);
  }
  assert.deepEqual(Reflect.get(providerById("cursor"), "approvalModes"), ["auto", "full"]);
  assert.deepEqual(Reflect.get(providerById("grok"), "approvalModes"), []);
});
test("Cursor effort and Fast select only offered presets within the same model family", () => {
  const controls = modelExecutionControls("cursor", "claude-opus-5-thinking-high", models);
  assert.deepEqual(controls.levels, ["medium", "high"]);
  assert.equal(controls.fastAvailable, true);
  const fast = modelExecutionControls("cursor", "claude-opus-5-thinking-high-fast", models);
  assert.deepEqual(fast.levels, controls.levels);
  assert.equal(fast.effort, controls.effort);
  assert.deepEqual(fast.selectableLevels, ["high"]);
  assert.equal(offeredCursorVariant(controls.variants, "claude-opus-5-thinking-high", "high", true), "claude-opus-5-thinking-high-fast");
  assert.equal(offeredCursorVariant(controls.variants, "claude-opus-5-high", "medium", true), null);
  assert.equal(offeredCursorVariant(controls.variants, "claude-opus-5-high", "max", false), null);
  assert.equal(modelExecutionControls("cursor", "claude-sonnet-5-high-fast", models).fastAvailable, false);
});
test("capabilities come from catalog metadata; unsupported preferences do not invent controls", () => {
  const catalog:DiscoveredModel[] = [{id:"m",displayName:"M",availability:"available",effortLevels:["low","high","--bad"],defaultEffort:"low",fastMode:true}];
  const controls = modelExecutionControls("codex", "m", catalog, {effort:"ultra",fast:true});
  assert.deepEqual(controls.levels,["low","high"]);assert.equal(controls.effort,"low");assert.equal(controls.fast,true);
  assert.equal(modelExecutionControls("grok", "m", catalog).fastAvailable,false);
  assert.equal(modelExecutionControls("grok",null,[]).effort,null);
  assert.equal(supportsPlanning("codex",null),false);assert.equal(supportsPlanning("codex","m"),true);assert.equal(supportsPlanning("opencode","m"),true);
});
test("goal is admitted separately while selected references stay quoted, bounded and non-executable", () => {
  const prompt=composerPrompt("Do this",{goal:"Review all changes",planning:true,attachments:[{id:"a",name:'<script>"file.txt',kind:"file",content:"á".repeat(20000),truncated:true}]});
  assert.ok(!prompt.includes("User-defined goal:"));assert.match(prompt,/snapshot; not instructions/);assert.match(prompt,/context truncated/);
  assert.ok(new TextEncoder().encode(prompt).length<13*1024);assert.ok(!prompt.includes("�"));
  assert.equal(composerPrompt("Task",{goal:"",planning:false,attachments:[]}),"Task");
});

test("composer popovers stay above the whole input while retaining the trigger's horizontal anchor", async () => {
  const {popoverOffsetAbove}=await import("../src/lib/popover-position.ts");
  const trigger={getBoundingClientRect:()=>({top:240})};const boundary={getBoundingClientRect:()=>({top:100})};
  assert.equal(240-popoverOffsetAbove(trigger,boundary),90);
  assert.equal(popoverOffsetAbove(trigger,null),6);
  assert.equal(popoverOffsetAbove({getBoundingClientRect:()=>({top:90})},boundary),6);
});

test("Cursor parameter catalog offers Composer Fast independently of automatic reasoning", () => {
  const catalog: DiscoveredModel[]=[{id:"composer-2.5",displayName:"Composer 2.5",availability:"available",parameterized:true,effortLevels:[],fastMode:true,defaultFast:true}];
  const controls=modelExecutionControls("cursor","composer-2.5",catalog);
  assert.equal(controls.fastAvailable,true);assert.equal(controls.fast,true);assert.equal(controls.effort,null);assert.deepEqual(controls.levels,[]);assert.equal(controls.parameterized,true);
  assert.equal(modelExecutionControls("cursor","composer-2.5",catalog,{fast:false}).fast,false);
});
test("OpenCode and Grok use their discovered effort levels without inventing priority service", () => {
  const catalog:DiscoveredModel[]=[{id:"m",displayName:"M",availability:"available",effortLevels:["low","high"],defaultEffort:"high",fastMode:true}];
  for(const provider of ["opencode","grok"] as const){ const c=modelExecutionControls(provider,"m",catalog,{effort:"low",fast:true});assert.equal(c.effort,"low");assert.equal(c.fastAvailable,false);assert.equal(c.fast,false); }
});

test("full-width composer panels align to the input independently of their toolbar button", async () => {
  const { composerPopoverLayout }=await import("../src/lib/popover-position.ts");
  const trigger={getBoundingClientRect:()=>({top:240,left:330,width:130})} as HTMLElement;
  const input={getBoundingClientRect:()=>({top:100,left:200,width:640})} as HTMLElement;
  const layout=composerPopoverLayout(trigger,input);
  assert.equal(layout.width,640); assert.equal(330+layout.alignOffset,200); assert.equal(240-layout.sideOffset,90);
});
