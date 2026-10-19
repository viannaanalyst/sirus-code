import { test } from "node:test";
import assert from "node:assert/strict";
import { composerPaintSegments, describeLinkChip, isBareLinkText, isLocalHost, linkSite, parseGitHubItemUrl, prettifyUrl, projectRepository, resolveLinkDestination, shortenGitHubLink, wantsSystemBrowser, type LinkRules } from "../src/lib/link-chips.ts";

test("GitHub links shorten to owner, repo, #number and @commit", () => {
  assert.equal(shortenGitHubLink("https://github.com/acme"), "acme");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/"), "acme/rocket");
  assert.equal(shortenGitHubLink("https://www.github.com/acme/rocket.git"), "acme/rocket");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/pull/155"), "acme/rocket#155");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/pull/155/files"), "acme/rocket#155");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/issues/7#issuecomment-1"), "acme/rocket#7");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/commit/abcdef1234567890"), "acme/rocket@abcdef1");
  assert.equal(shortenGitHubLink("https://github.com/acme/rocket/blob/main/README.md"), null);
  assert.equal(shortenGitHubLink("https://github.com/"), null);
  assert.equal(shortenGitHubLink("https://gitlab.com/acme/rocket"), null);
});

test("other links lose the scheme, www. and the trailing slash", () => {
  assert.equal(prettifyUrl("https://www.example.com/"), "example.com");
  assert.equal(prettifyUrl("http://docs.rs/serde/latest/"), "docs.rs/serde/latest");
  assert.deepEqual(describeLinkChip("https://www.example.com/a?b=1"), { label: "example.com/a?b=1", github: false });
  assert.deepEqual(describeLinkChip("https://github.com/acme/rocket/pull/3"), { label: "acme/rocket#3", github: true });
  assert.equal(isBareLinkText("https://example.com/", "https://example.com"), true);
  assert.equal(isBareLinkText("example.com", "https://www.example.com"), true);
  assert.equal(isBareLinkText("the docs", "https://example.com"), false);
});

test("icons: the GitHub mark, a favicon host, or a local glyph", () => {
  assert.deepEqual(linkSite("https://github.com/acme/rocket"), { kind: "github" });
  assert.deepEqual(linkSite("https://www.Example.com/x"), { kind: "site", host: "example.com" });
  for (const local of ["http://localhost:5173/", "http://127.0.0.1:8080", "http://192.168.0.3/", "http://[::1]:3000/", "http://app.local/", "http://intranet/", "https://mac.tail12.ts.net/"]) {
    assert.deepEqual(linkSite(local), { kind: "local" }, local);
  }
  assert.equal(isLocalHost("example.com"), false);
  assert.equal(isLocalHost("dev.localhost"), true);
});

test("pull request and issue links match a project's repository", () => {
  assert.deepEqual(parseGitHubItemUrl("https://github.com/Acme/Rocket/pull/12/files"), { repository: "Acme/Rocket", number: 12, kind: "pullRequest" });
  assert.deepEqual(parseGitHubItemUrl("https://github.com/acme/rocket/issues/4"), { repository: "acme/rocket", number: 4, kind: "issue" });
  assert.equal(parseGitHubItemUrl("https://github.com/acme/rocket/commit/abc1234"), null);
  assert.equal(projectRepository(["acme/Rocket"], "ACME/rocket"), "acme/Rocket");
  assert.equal(projectRepository(["acme/rocket"], "other/rocket"), null);
});

test("a click goes to the Pull requests page, the Sirus browser or the system browser", () => {
  const rules: LinkRules = { linkOpenTarget: "app", githubLinksInApp: true, repositories: ["acme/rocket"], browserAvailable: true };
  const pull = "https://github.com/Acme/Rocket/pull/9";
  assert.deepEqual(resolveLinkDestination(pull, null, rules), { kind: "pulls", key: "acme/rocket#9" });
  assert.deepEqual(resolveLinkDestination("https://github.com/acme/rocket/issues/2", {}, rules), { kind: "pulls", key: "acme/rocket#2" });
  // Not a project's repository, or the setting is off: like any other link.
  assert.deepEqual(resolveLinkDestination("https://github.com/other/thing/pull/1", null, rules), { kind: "browser" });
  assert.deepEqual(resolveLinkDestination(pull, null, { ...rules, githubLinksInApp: false }), { kind: "browser" });
  assert.deepEqual(resolveLinkDestination("https://example.com", null, rules), { kind: "browser" });
  assert.deepEqual(resolveLinkDestination("https://example.com", null, { ...rules, linkOpenTarget: "system" }), { kind: "system" });
  assert.deepEqual(resolveLinkDestination("https://example.com", null, { ...rules, browserAvailable: false }), { kind: "system" });
  for (const click of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(wantsSystemBrowser(click), true);
    assert.deepEqual(resolveLinkDestination(pull, click, rules), { kind: "system" });
    assert.deepEqual(resolveLinkDestination("https://example.com", click, rules), { kind: "system" });
  }
  assert.equal(wantsSystemBrowser({ button: 0 }), false);
  assert.deepEqual(resolveLinkDestination("mailto:a@b.com", null, rules), { kind: "system" });
});

test("the composer paints web addresses without changing the text", () => {
  const value = "/review see https://example.com/a, and @src/main.ts";
  const painted = composerPaintSegments(value);
  assert.equal(painted.map((segment) => segment.text).join(""), value);
  assert.deepEqual(painted.filter((segment) => segment.kind !== "text").map((segment) => [segment.kind, segment.text]), [
    ["skill", "/review"], ["link", "https://example.com/a"], ["file", "@src/main.ts"],
  ]);
  assert.deepEqual(composerPaintSegments("plain words"), [{ text: "plain words", kind: "text" }]);
});
