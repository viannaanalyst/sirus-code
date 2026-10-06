// Embeds a downscaled copy of the app glyph so index.html stays self-contained.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const here = new URL(".", import.meta.url).pathname;
const out = join(mkdtempSync(join(tmpdir(), "glyph-")), "glyph.png");
execFileSync("sips", ["-Z", "360", join(here, "../../public/sirus-glyph.png"), "--out", out], { stdio: "ignore" });
const data = `data:image/png;base64,${readFileSync(out).toString("base64")}`;
writeFileSync(join(here, "index.html"), readFileSync(join(here, "source.html"), "utf8").replace("__GLYPH__", data));
console.log("previews/premium-motion/index.html written");
