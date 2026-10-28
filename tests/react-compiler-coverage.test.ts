import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";

// ADR-183: every non-test source file under src/ must compile with the React Compiler. A file the
// compiler skips still builds, but silently loses memoization, so a bailout fails here instead.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

/**
 * Files with at least one component or hook the compiler skips. A skipped function still works, it
 * is just not auto-memoized (the old useMemo/useCallback/memo keep doing their job). Each group
 * says why; fix a file and the stale-entry test below makes you remove it. Keep this list shrinking.
 */
const allowlist = new Set<string>([
  // try/finally, try without catch, or throw inside try: not supported by the compiler yet, so the component is not memoized
  "components/AgentComposer.tsx",
  "components/AgentResources.tsx",
  "components/BrowserPanel.tsx",
  "components/ComposerAddMenu.tsx",
  "components/ComposerCommandPanels.tsx",
  "components/ComposerImageAttachment.tsx",
  "components/CreateProjectDialog.tsx",
  "components/EnvironmentPanel.tsx",
  "components/FileTree.tsx",
  "components/GitIncomingButton.tsx",
  "components/LandingControls.tsx",
  "components/MermaidDiagram.tsx",
  "components/NewSessionDialog.tsx",
  "components/ProjectActions.tsx",
  "components/ProviderAccountsPanel.tsx",
  "components/ProviderUsagePanel.tsx",
  "components/SessionActions.tsx",
  "components/TeamPanel.tsx",
  "components/TurnChangeSummary.tsx",
  "components/UsageLimitAccountPicker.tsx",
  "components/WorkspacesPanel.tsx",
  "components/arc/rich-text-editor/rich-text-editor.tsx",
  "components/devices/DevicesPane.tsx",
  "components/mobile/MobileApp.tsx",
  "components/mobile/MobileEnvironments.tsx",
  "components/mobile/MobileSettings.tsx",
  "components/mobile/PhoneComposerControls.tsx",
  "components/settings/AppearanceSettings.tsx",
  "components/settings/ComputersSettings.tsx",
  "components/settings/ConnectionsSettings.tsx",
  "components/settings/ConnectorsSettings.tsx",
  "components/settings/CookieImportDialog.tsx",
  "components/settings/McpServerDialog.tsx",
  "components/settings/NotificationSettings.tsx",
  "components/settings/PairDeviceDialog.tsx",
  "components/settings/ProviderRow.tsx",
  "components/settings/SettingsPanels.tsx",
  "components/usage/UsagePage.tsx",
  "lib/use-mcp-catalog.ts",
  "primitives/ConfirmDialog.tsx",
  // reads or writes a ref during render on purpose (render-time bookkeeping)
  "components/ChatMarkdown.tsx",
  "components/MessageTrail.tsx",
  "components/SessionPane.tsx",
  "components/SidebarWindow.tsx",
  "components/StreamFadeText.tsx",
  "components/TerminalPanel.tsx",
  "components/editor/CodeEditor.tsx",
  "components/mobile/MobileChat.tsx",
  "components/mobile/MobileSwipeRow.tsx",
  "components/mobile/MobileTerminal.tsx",
  "components/review-guide/ReviewGuideTour.tsx",
  "lib/use-smooth-text.ts",
  "lib/use-stream-fade.ts",
  // a react-hooks eslint-disable comment makes the compiler skip the component
  "components/ChangesPane.tsx",
  "components/DiffViewer.tsx",
  "components/arc/usage-meter/usage-meter.tsx",
  "components/mobile/MobileFiles.tsx",
  "components/mobile/MobileGit.tsx",
  "components/mobile/MobileThreadSettings.tsx",
  "components/mobile/MobileUsage.tsx",
  "lib/use-pointer-reorder.ts",
  // existing useMemo/useCallback dependencies the compiler cannot preserve
  "components/HeaderTabs.tsx",
  "components/ReplyChoices.tsx",
  "components/arc/calendar/calendar.tsx",
  "components/arc/ridgeline/ridgeline.tsx",
  "components/arc/streamgraph/streamgraph.tsx",
  "components/arc/waffle-chart/waffle-chart.tsx",
  // reassigns or mutates a local during render (counters, lazy state)
  "components/AgentActivity.tsx",
  "components/ConversationSidebar.tsx",
  "components/arc/number-field/number-field.tsx",
  "components/arc/text-morph/text-morph.tsx",
  "components/arc/text-reveal/text-reveal.tsx",
  "components/diff/DiffCode.tsx",
  "components/settings/SettingsSidebar.tsx",
  "lib/use-browser-bounds.ts",
  // syntax or pattern the compiler does not lower yet (getters, reordering, tagged templates, value blocks in try)
  "components/ComposerDictationButton.tsx",
  "components/ComposerEditor.tsx",
  "components/ModelEffortPanel.tsx",
  "components/ProjectAvatar.tsx",
  "components/TranscriptSelectionMenu.tsx",
  "components/UndoTurnButton.tsx",
  "components/arc/bar-chart/bar-chart.tsx",
  "components/arc/brush-chart/brush-chart.tsx",
  "components/arc/chat-thread/chat-thread.tsx",
  "components/arc/comment-thread/comment-thread.tsx",
  "components/arc/confirm-morph/confirm-morph.tsx",
  "components/arc/donut-chart/donut-chart.tsx",
  "components/arc/file-dropzone/file-dropzone.tsx",
  "components/arc/gauge/gauge.tsx",
  "components/arc/hold-to-confirm/hold-to-confirm.tsx",
  "components/arc/image-compare/image-compare.tsx",
  "components/arc/json-viewer/json-viewer.tsx",
  "components/arc/line-chart/line-chart.tsx",
  "components/arc/mention-input/mention-input.tsx",
  "components/arc/phone-input/phone-input.tsx",
  "components/arc/resizable-panels/resizable-panels.tsx",
  "components/arc/scroll-area/scroll-area.tsx",
  "components/arc/signature-pad/signature-pad.tsx",
  "components/arc/treemap/treemap.tsx",
  "components/mobile/MobileAddProject.tsx",
  "components/pull-requests/PullRequestChecks.tsx",
]);

const files = (readdirSync(root, { recursive: true }) as string[])
  .map((file) => file.split(path.sep).join("/"))
  .filter(
    (file) => /\.tsx$/.test(file) || /(^|\/)use[A-Za-z0-9-]*\.ts$/.test(file),
  )
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .sort();

type CompilerEvent = {
  kind: string;
  detail?: { reason?: string };
  fnLoc?: { start?: { line?: number } };
};

function bailouts(file: string): string[] {
  const filename = path.join(root, file);
  const found: string[] = [];
  transformSync(readFileSync(filename, "utf8"), {
    filename,
    babelrc: false,
    configFile: false,
    code: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      [
        reactCompiler,
        {
          panicThreshold: "none",
          logger: {
            logEvent(_name: string, event: CompilerEvent) {
              if (
                event.kind === "CompileError" ||
                event.kind === "PipelineError"
              ) {
                found.push(
                  `line ${event.fnLoc?.start?.line ?? "?"}: ${event.detail?.reason ?? event.kind}`,
                );
              }
            },
          },
        },
      ],
    ],
  });
  return found;
}

for (const file of files) {
  if (allowlist.has(file)) {
    test(`React Compiler allowlist entry still needed: ${file}`, () => {
      assert.notDeepEqual(
        bailouts(file),
        [],
        `${file} compiles now: remove it from the allowlist`,
      );
    });
  } else {
    test(`React Compiler compiles ${file}`, () => {
      assert.deepEqual(bailouts(file), []);
    });
  }
}

test("React Compiler allowlist has no missing files", () => {
  for (const file of allowlist)
    assert.ok(
      files.includes(file),
      `${file} is allowlisted but no longer exists`,
    );
});
