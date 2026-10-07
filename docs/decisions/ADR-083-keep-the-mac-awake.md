# ADR-083: Keep the Mac awake for paired devices

**Status:** Accepted

## Context

Remote access (ADR-080) and phone alerts (ADR-082) need an awake Mac. A sleeping Mac drops its network and pauses Sirus and its agents, and Tailscale cannot wake it. People step away with the Mac on the desk, and the default energy settings put it to sleep within minutes.

## Decision

Settings → Connections gains "Keep the Mac awake for the phone", shown while remote access is on and off by default. It is stored as `keepAwake` in `remote.json`.

- While remote access and the switch are both on, `remote.rs` runs `/usr/bin/caffeinate -s -w <Sirus pid>`. It uses a fixed argv and no shell.
- `-s` asks macOS to prevent system sleep only while on AC power. On battery, sleep works as usual. The display still turns off and locks.
- `-w` releases the assertion if Sirus quits or crashes without cleaning up.
- The switch, turning remote access off and quitting all stop `caffeinate`. The status re-checks it and starts it again if it ended.
- Closing a MacBook's lid without an external display still sleeps it. That is a macOS rule, and working around it (`pmset disablesleep`) needs administrator rights and risks heat in a closed bag, so it is not offered.

## Consequences

- With the Mac plugged in and the lid open, paired devices can reach it at any time.
- The cost is an idle Mac with its display off, instead of a sleeping one.
