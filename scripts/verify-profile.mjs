// Real product component renders without starting IPC, providers or a browser.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { ProfileSettings } = await server.ssrLoadModule("/src/components/settings/ProfileSettings.tsx");
  const { ProfileShareContent } = await server.ssrLoadModule("/src/components/profile/ShareProfileDialog.tsx");
  const { EditProfileContent } = await server.ssrLoadModule("/src/components/profile/EditProfileDialog.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { buildProfileStats } = await server.ssrLoadModule("/src/lib/profile-stats.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  const project = { id: "p", name: "Workspace", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
  const session = { id: "s", projectId: "p", agent: "opencode", model: "opencode-go/deepseek-v4.1-flash", title: "Fixture", status: "completed", createdAt: "2026-09-01T00:00:00Z", lastActivityAt: "2026-10-01T12:00:00Z", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [{ id: "m", sessionId: "s", role: "user", content: "Secret prompt must not appear", createdAt: "2026-10-01T12:00:00Z", streaming: false }], lastError: null };
  const initial = useAppStore.getInitialState();
  const settings = mergeSettings({ locale: "pt-BR", profile: { name: "Gabriel <script>private</script>", handle: "gabrielvianna", avatarColor: "silver", avatarImage: null } });
  Object.assign(initial, { settings, projects: [project], sessions: [session], modelsByProvider: {} });
  useAppStore.setState({ settings, projects: [project], sessions: [session], modelsByProvider: {} });
  const markup = renderToString(createElement(ProfileSettings, { settings, host: { profileDefaultName: "Default" } }));
  for (const key of ["Profile", "Share", "Edit", "Lifetime tokens", "Total prompts", "Activity", "Most used plugins", "Model usage", "Historical token totals are unavailable."]) assert.ok(markup.includes(translate("pt-BR", key)), `${key} is localized`);
  assert.ok(markup.includes("Gabriel &lt;script&gt;private&lt;/script&gt;"));
  assert.ok(markup.includes("@gabrielvianna"));
  assert.doesNotMatch(markup, /<script>|Secret prompt|\/fixture|role="tooltip"/);
  assert.equal([...markup.matchAll(/class="profile-heatmap-cell"/g)].length, 274);
  assert.match(markup, /role="meter"[^>]*aria-valuenow="100"/);
  assert.ok(markup.includes("deepseek"), "real routed model brand renders");
  const stats = buildProfileStats([project], [session], new Date("2026-10-02T12:00:00Z"));
  const share = renderToString(createElement(ProfileShareContent, { profile: settings.profile, defaultName: "Default", stats }));
  for (const label of ["Copy activity image", "Save activity image"]) assert.ok(share.includes(`aria-label="${translate("pt-BR", label)}"`));
  for (const network of ["X", "LinkedIn", "Reddit"]) assert.ok(share.includes(`aria-label="${translate("pt-BR", "Share activity on {network}", { network })}"`));
  assert.equal([...share.matchAll(/class="profile-share-action"/g)].length, 5);
  assert.doesNotMatch(share, /role="tooltip"|Secret prompt|<script>/);
  const edit = renderToString(createElement(EditProfileContent, { profile: settings.profile, defaultName: "Default", onClose: () => {} }));
  assert.match(edit, /<form/);
  assert.match(edit, /type="submit"/);
  for (const key of ["Display name", "Username"]) {
    const label = [...edit.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([^<]+)<\/label>/g)].find(match => match[2] === translate("pt-BR", key));
    assert.ok(label, `${key} retains an associated native label`);
    assert.ok(edit.includes(`id="${label[1]}"`));
  }
  assert.equal([...edit.matchAll(/type="radio"/g)].length, 5);
  assert.doesNotMatch(edit, /role="tooltip"|<script>/);
  console.log("Profile identity, real retained activity, routing, share actions and localization renders passed");
} finally { await server.close(); }
