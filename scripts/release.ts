// `npm run release -- <version> [--dry-run] [--skip-checks] [--notes "…"] [--key path]` (ADR-140).
//
// Publishes a Sirus Code release from this Mac: checks the tree, bumps the version, runs the
// checks, builds the release app and DMG with signed update artifacts, writes latest.json,
// commits "Release vX.Y.Z", tags, pushes and creates the GitHub release with the files the
// website and the in-app updater download. `--dry-run` builds and writes everything under
// src-tauri/target/release-upload/vX.Y.Z but changes no tracked file and never commits,
// tags, pushes or uploads.
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DMG_ASSET,
  REPOSITORY,
  UPDATE_ASSET,
  compareVersions,
  feedProblems,
  latestTag,
  notesFromCommits,
  parseArgs,
  parseVersion,
  bumpCargoLock,
  bumpCargoVersion,
  bumpJsonVersion,
  updateFeed,
  verifyUpdateSignature,
} from "./release-lib.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const tauriDir = path.join(root, "src-tauri");
const DEFAULT_KEY = path.join(homedir(), ".config", "sirus-code", "updater.key");
const LOCAL_IDENTITY = "Sirus Code Local Signing";
const NOTARIZATION_VARS = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"];
const VERSIONED = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];

const env = { ...process.env, PATH: `${path.join(homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}` };

function step(message: string) {
  console.log(`\n▸ ${message}`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed${result.status === null ? "" : ` (exit ${result.status})`}`);
}

function capture(command: string, args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`);
  return String(result.stdout ?? "").trim();
}

function succeeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd: root, stdio: "ignore", env }).status === 0;
}

const options = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();
const version = options.version;
const tag = `v${version}`;
const dry = options.dryRun;
const prerelease = (parseVersion(version)?.pre.length ?? 0) > 0;
const warnOrFail = (message: string) => (dry ? console.warn(`  ! ${message} (allowed in a dry run)`) : fail(message));

console.log(`Sirus Code release ${tag}${dry ? " — dry run: nothing is committed, tagged, pushed or uploaded" : ""}`);

// 1. Where we are.
step("Checking the repository");
if (process.platform !== "darwin" || process.arch !== "arm64") fail("Releases are built on an Apple silicon Mac.");
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") warnOrFail(`Releases are made from main; this is ${branch}.`);
const dirty = capture("git", ["status", "--porcelain"]);
if (dirty) warnOrFail(`The working tree has uncommitted changes:\n${dirty}`);
if (!dry) {
  run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
  const behind = Number(capture("git", ["rev-list", "--count", "HEAD..origin/main"]));
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main; pull first.`);
  if (!succeeds("gh", ["auth", "status"])) fail("The GitHub CLI is not signed in (gh auth login).");
  if (succeeds("gh", ["release", "view", tag, "--repo", REPOSITORY])) fail(`The GitHub release ${tag} already exists.`);
}
const tags = capture("git", ["tag", "--list", "v*"]).split("\n");
if (tags.includes(tag)) fail(`The tag ${tag} already exists.`);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const current = parseVersion(pkg.version);
const wanted = parseVersion(version)!;
if (!current) fail(`package.json has an unreadable version (${pkg.version}).`);
if (compareVersions(wanted, current) <= 0) fail(`${version} is not newer than the current version ${pkg.version}.`);
const previous = latestTag(tags);
const previousVersion = previous ? parseVersion(previous) : null;
if (previousVersion && compareVersions(wanted, previousVersion) <= 0) fail(`${version} is not newer than the last tag ${previous}.`);
console.log(`  ${pkg.version} → ${version}${previous ? ` (last tag ${previous})` : ""}`);

// 2. The update signing key: outside the repository, never printed.
step("Reading the update signing key");
const keyPath = path.resolve(options.key ?? process.env.SIRUS_UPDATER_KEY ?? DEFAULT_KEY);
if (!existsSync(keyPath)) fail(`No update signing key at ${keyPath}. See docs/development/building.md → Releases.`);
if (!path.relative(root, keyPath).startsWith("..")) fail("The update signing key must live outside the repository.");
if ((statSync(keyPath).mode & 0o077) !== 0) {
  console.warn(`  ! ${keyPath} is readable by other users; restricting it to you.`);
  chmodSync(keyPath, 0o600);
}
const privateKey = readFileSync(keyPath, "utf8").trim();
const tauriConf = JSON.parse(readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8")) as { plugins?: { updater?: { pubkey?: string } } };
const pubkey = tauriConf.plugins?.updater?.pubkey;
if (!pubkey) fail("tauri.conf.json has no plugins.updater.pubkey.");
console.log(`  ${keyPath}`);

// 3. Release notes.
const notes = options.notes?.trim() || notesFromCommits(
  capture("git", ["log", "--no-merges", "--pretty=%s", ...(previous ? [`${previous}..HEAD`] : ["-n", "30"])]).split("\n"),
);

// 4. Version bump (real releases only; a dry run passes the version to the build instead).
const originals = new Map<string, string>();
const restore = () => {
  for (const [file, text] of originals) writeFileSync(path.join(root, file), text);
  originals.clear();
};
const bump = () => {
  const edits: Record<string, (text: string) => string> = {
    "package.json": (text) => bumpJsonVersion(text, version),
    "src-tauri/tauri.conf.json": (text) => bumpJsonVersion(text, version),
    "src-tauri/Cargo.toml": (text) => bumpCargoVersion(text, version),
    "src-tauri/Cargo.lock": (text) => bumpCargoLock(text, "sirus-code", version),
  };
  for (const file of VERSIONED) {
    const full = path.join(root, file);
    const text = readFileSync(full, "utf8");
    originals.set(file, text);
    writeFileSync(full, edits[file](text));
  }
};

const uploadDir = path.join(tauriDir, "target", "release-upload", tag);
try {
  if (!dry) {
    step("Bumping the version");
    bump();
    console.log(`  ${VERSIONED.join(", ")}`);
  }

  // 5. Checks.
  if (options.skipChecks) {
    step("Skipping the checks (--skip-checks)");
  } else {
    step("Running the checks");
    run("npm", ["run", "typecheck"]);
    run("npm", ["run", "lint"]);
    run("npm", ["test"]);
    run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], { cwd: tauriDir });
    run("cargo", ["clippy", "--no-default-features", "--features", "host", "--all-targets", "--", "-D", "warnings"], { cwd: tauriDir });
    run("cargo", ["test"], { cwd: tauriDir });
  }

  // 6. Code signing and notarization.
  step("Choosing how the app is signed");
  const identities = capture("security", ["find-identity", "-p", "codesigning"]);
  const identity = process.env.APPLE_SIGNING_IDENTITY
    ?? (identities.includes(`"${LOCAL_IDENTITY}"`) ? LOCAL_IDENTITY : "-");
  const notarizeWith = process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER ? "an App Store Connect API key"
    : process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID ? "an Apple ID"
      : null;
  const buildEnv: NodeJS.ProcessEnv = { ...env, TAURI_SIGNING_PRIVATE_KEY: privateKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.SIRUS_UPDATER_KEY_PASSWORD ?? "" };
  if (notarizeWith) {
    if (!/^Developer ID Application:/.test(identity)) throw new Error("Notarization needs a Developer ID Application identity in APPLE_SIGNING_IDENTITY.");
    console.log(`  Signing with ${identity}; notarizing with ${notarizeWith}.`);
  } else {
    for (const name of NOTARIZATION_VARS) delete buildEnv[name];
    console.log(`  Signing with ${identity === "-" ? "an ad-hoc signature" : `“${identity}”`}.`);
    console.log("  Skipping notarization: set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID (or APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH)");
    console.log("  with a Developer ID identity in APPLE_SIGNING_IDENTITY to notarize. A downloaded DMG then opens without");
    console.log("  System Settings → Privacy & Security → Open Anyway; in-app updates work either way.");
  }

  // 7. Release build: the .app with its signed update archive, and the DMG.
  step("Building the release app and DMG (this takes a while)");
  const config = {
    ...(dry ? { version } : {}),
    bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: identity } },
  };
  run("npx", ["tauri", "build", "--bundles", "app,dmg", "--config", JSON.stringify(config)], { env: buildEnv });

  // 8. Collect the files under names without spaces, and check the signature as the app will.
  step("Collecting the release files");
  const bundle = path.join(tauriDir, "target", "release", "bundle");
  const archive = path.join(bundle, "macos", "Sirus Code.app.tar.gz");
  const dmg = path.join(bundle, "dmg", `Sirus Code_${version}_aarch64.dmg`);
  for (const file of [archive, `${archive}.sig`, dmg]) if (!existsSync(file)) throw new Error(`The build did not produce ${path.relative(root, file)}.`);
  const signature = readFileSync(`${archive}.sig`, "utf8").trim();
  const checked = verifyUpdateSignature(readFileSync(archive), signature, pubkey);
  if (!checked.ok) throw new Error(`The update signature does not verify against tauri.conf.json's public key: ${checked.reason}.`);
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });
  copyFileSync(dmg, path.join(uploadDir, DMG_ASSET));
  copyFileSync(archive, path.join(uploadDir, UPDATE_ASSET));
  writeFileSync(path.join(uploadDir, `${UPDATE_ASSET}.sig`), `${signature}\n`);
  const feed = updateFeed({ version, notes, date: new Date(), signature });
  const problems = feedProblems(feed);
  if (problems.length) throw new Error(`latest.json is not valid: ${problems.join(", ")}.`);
  writeFileSync(path.join(uploadDir, "latest.json"), `${JSON.stringify(feed, null, 2)}\n`);
  writeFileSync(path.join(uploadDir, "notes.md"), `${notes}\n`);
  console.log(`  ${path.relative(root, uploadDir)}/`);
  for (const name of [DMG_ASSET, UPDATE_ASSET, `${UPDATE_ASSET}.sig`, "latest.json"]) console.log(`    ${name}`);
} catch (error) {
  restore();
  fail(`${error instanceof Error ? error.message : String(error)}${dry ? "" : "\n  The version files were restored; nothing was committed."}`);
}

const assets = [DMG_ASSET, UPDATE_ASSET, `${UPDATE_ASSET}.sig`, "latest.json"].map((name) => path.join(uploadDir, name));
const releaseArgs = [
  "release", "create", tag, ...assets,
  "--repo", REPOSITORY,
  "--title", `Sirus Code ${version}`,
  "--notes-file", path.join(uploadDir, "notes.md"),
  "--verify-tag",
  ...(prerelease ? ["--prerelease"] : ["--latest"]),
];

if (dry) {
  step("Dry run finished. A real release would now run:");
  console.log(`  bump ${VERSIONED.join(", ")} to ${version}`);
  console.log(`  git commit -m "Release ${tag}" -- ${VERSIONED.join(" ")}`);
  console.log(`  git tag -a ${tag} -m "Sirus Code ${version}"`);
  console.log(`  git push origin main ${tag}`);
  console.log(`  gh ${releaseArgs.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);
  console.log(`\nRelease notes:\n${notes}`);
  process.exit(0);
}

// 9. Publish: commit, tag, push, then the GitHub release with the four files.
try {
  step(`Committing and tagging ${tag}`);
  run("git", ["add", "--", ...VERSIONED]);
  run("git", ["commit", "-m", `Release ${tag}`, "--", ...VERSIONED]);
} catch (error) {
  restore();
  fail(`${error instanceof Error ? error.message : String(error)}\n  The version files were restored.`);
}
try {
  run("git", ["tag", "-a", tag, "-m", `Sirus Code ${version}`]);
  step("Pushing main and the tag");
  run("git", ["push", "origin", "main", tag]);
  step("Creating the GitHub release");
  run("gh", releaseArgs);
} catch (error) {
  fail(`${error instanceof Error ? error.message : String(error)}
  The release commit exists locally. Finish by hand once the cause is fixed:
    git tag -a ${tag} -m "Sirus Code ${version}"   (if the tag is missing)
    git push origin main ${tag}
    gh ${releaseArgs.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);
}
console.log(`\n✓ Sirus Code ${version} is published: https://github.com/${REPOSITORY}/releases/tag/${tag}`);
console.log("  Installed apps offer it within a few hours (or at once from Settings → Advanced → Check for updates).");
