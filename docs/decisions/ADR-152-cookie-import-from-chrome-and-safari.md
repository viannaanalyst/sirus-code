# ADR-152: Import cookies from Chrome and Safari into a browser profile, with explicit consent

**Status:** Accepted (2026-10-19). Built and unit-tested. The Keychain prompt, a real Chrome profile and Full Disk Access for Safari are checked by hand on a Mac, not in CI.

## Context

ADR-150 kept cookie import out: a profile keeps only what the person signs in to in it. Two people asked for the common case, a sign-in that already exists in Chrome or Safari. Chrome encrypts its cookie values with a key kept in the Keychain item "Chrome Safe Storage", so reading them means a Keychain prompt for another application's secret. Safari's cookie file sits behind Full Disk Access. Both are sensitive, so the import has to be started by the owner and say exactly what it does.

## Decision

### Consent

- Only the owner starts an import: Settings → Browser profiles → "Import cookies from a browser", on Default or on a saved custom profile. Private is never a target, and nothing else (agents, startup, schedules) can start one.
- The source list shows Chrome profiles that have a cookie file (`Default`, `Profile N`, named from Chrome's `Local State`) and Safari. Listing reads folder names only.
- The domain list shows names and counts, never values. Nothing is preselected.
- The consent step names the source browser and profile, the target profile, and every selected domain, and says the cookies become sessions in that profile. Only its Import button starts the import; Back returns without reading anything more.
- The back end accepts an import only for Default or a saved custom profile (never Private), and only for well-formed domain names (at most 500). It cannot see the owner's click, so the consent is the renderer flow above, and nothing in the back end imports on its own.
- Nothing is logged beyond the domain list and the counts. Values and the key stay in memory and are dropped when the import returns. Nothing is sent over the network.

### Chrome (macOS)

- The `Cookies` file (and its `-wal`, if present) is copied to a temporary folder, because Chrome keeps the original open. The copy is read read-only with `rusqlite` (already a dependency), and the folder is deleted when the read returns.
- The key comes from `security find-generic-password -w -s "Chrome Safe Storage"`. macOS shows its Keychain prompt at that point, and the prompt is the owner's consent for the key. It is requested only when a selected cookie is `v10`, so a profile without encrypted cookies never asks.
- PBKDF2-HMAC-SHA1 (salt `saltysalt`, 1003 rounds, 16 bytes) gives the AES-128 key. Values are AES-128-CBC with PKCS#7 padding and an IV of sixteen spaces.
- From Chrome 130 the plaintext starts with SHA-256 of the host key. The first 32 bytes are removed only when they match that hash, so a value is never cut by a guess.
- `v11` and unknown prefixes are skipped and counted; a value that is not text is skipped too. One bad cookie never fails the import.

### Safari

- Only `~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies` is read. The format is parsed directly: `cook`, page sizes, little-endian records with flags for Secure and HttpOnly, and Core Foundation dates.
- If macOS refuses the read, the owner sees a message that names Full Disk Access, with a button that opens Privacy & Security at that setting (a fixed address in `browser_open_full_disk_access`). Sirus does not prompt for it, and it tries no other path.

### Writing the cookies

- Each cookie becomes an `NSHTTPCookie` with name, value, domain (as stored, so a host-only cookie stays host-only), path, expiry, Secure and HttpOnly. Session cookies stay session cookies. Expired cookies are skipped.
- The cookies go to the profile's `WKHTTPCookieStore` on the main thread, and the import waits up to 15 seconds for WebKit to confirm them. The report gives the imported and skipped counts.

## Consequences

- The import is one-way: there is no per-cookie undo in Sirus. Deleting the profile (Settings → Browser profiles) removes everything it holds.
- The Keychain prompt is for another application's secret. It appears only when a Chrome cookie needs the key, and it can be refused, which fails the import with a message and copies nothing.
- Chrome may change its format. Unknown versions are skipped and counted, not guessed.
- `HttpOnly` is set through the property key `HttpOnly`, which Foundation does not document as a constant. If a future macOS drops it, imported cookies lose the flag, not their value.
- Safari's format is parsed from the documented layout and tested against a fixture built in the test. A real `Cookies.binarycookies` file on a Mac is the check that matters.
- Only Chrome and Safari are supported. Other Chromium browsers, Firefox and passkeys are not part of this change.
- Verified by unit tests: binarycookies parsing against an in-test fixture; Chrome key derivation (RFC 6070 vector), decryption with and without the 32-byte prefix, skipped prefixes, and a Chrome database read from a copy; domain filtering and bounds; profile discovery; and the renderer's selection and consent helpers. Both clippy builds and the full lib test suite pass. Not verified here: the Keychain prompt, a real Chrome profile, Safari with Full Disk Access, and the WebKit import in the running app.
