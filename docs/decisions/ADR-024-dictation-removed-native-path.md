# ADR-024: Dictation removed after a WebView crash; native Speech is the path

**Status:** Accepted (supersedes [ADR-023](ADR-023-composer-dictation.md))

## Context

ADR-023 added composer dictation through the WebView's Web Speech API
(`webkitSpeechRecognition`). The first click on the microphone crashed the
running app: WKWebView's speech recognition path is not stable in this host and
takes the whole process down instead of surfacing an error.

## Decision

- The mic control, `voice-dictation.ts`, the component and the
  `src-tauri/Info.plist` usage strings were removed. No dictation surface ships
  until a native implementation lands.
- The researched native path for a future attempt: Apple's Speech framework
  through Rust bindings (`objc2-speech` or the `speech-rs` safe wrapper),
  capturing audio natively (AVAudioEngine) and streaming partial transcripts to
  the renderer over a bounded event. On macOS 26 `DictationTranscriber` can run
  fully on-device. Alternatives: local Whisper via `whisper-rs`
  (push-to-talk, ships a model) or a self-hosted whisper.cpp/faster-whisper
  server on a VPS (network, privacy and maintenance costs).
- Any future implementation needs microphone/speech usage strings in the bundle
  and must not use `webkitSpeechRecognition` in this WebView.

## Consequences

- **Positive:** no crashing control; the typed path is unchanged; the research
  and the rejected approach are recorded.
- **Negative:** no dictation until the native work is scheduled.
- **Accepted trade-off:** postponing the feature over shipping an unstable one.

## Alternatives considered

- Retrying the Web Speech API with different flags: rejected — the failure is a
  process crash, not a recoverable error.
- Server-side transcription on a VPS: viable later for cross-platform, but adds
  audio egress, credentials and infrastructure for a single-user feature.
