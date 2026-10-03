# ADR-025: Native macOS dictation (SFSpeechRecognizer + AVAudioEngine)

**Status:** Superseded by ADR-027

## Context

ADR-024 removed WebView-based dictation after a `webkitSpeechRecognition`
process crash and recorded the native path as the way forward. The product is
macOS-only, so Apple's Speech framework is available on every target machine.

## Decision

- `dictation.rs` owns dictation natively: `SFSpeechRecognizer` for recognition
  and `AVAudioEngine` with an input tap feeding
  `SFSpeechAudioBufferRecognitionRequest`. Partial results stream to the
  renderer over one `dictation` event carrying `{ generation, text, final,
  error }`; only the final (or the last partial when stopping manually) appends
  to the composer draft.
- Commands: `dictation_status` (available / denied / restricted /
  notDetermined / unsupported), `start_dictation(locale)` where the locale is
  validated to the app's `pt-BR`/`en-US` pair, and `stop_dictation`. A single
  session exists process-wide; starting again stops the previous one and every
  event is keyed by generation so stale recognitions cannot append text.
- Authorization uses `SFSpeechRecognizer.requestAuthorization` with a bounded
  wait; microphone access is granted by the OS on the first engine start.
  `src-tauri/Info.plist` carries `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` for the bundled app. Non-macOS builds
  expose stubs so the command surface stays stable.
- The composer renders the mic control on supported platforms, including denied
  or restricted authorization so an attempted start can explain the permission
  issue through the existing error toast.
- The idle mic shares the Add control's bounded liquid-metal surface. During
  dictation, the approval/model/send controls yield to a silver orbital strip,
  recording clock, Cancel and Finish. Partial recognition text replaces the
  strip's listening caption; Cancel discards it, while Finish appends the last
  partial exactly once. Sending is blocked until recording ends. The listener
  binds before native start, and changing draft owners unmounts/stops dictation.
- The orbit and illustrative waveform pause offscreen, on hidden documents,
  under reduced motion or disabled interface animations. The waveform is
  decorative, not a measured audio level. The composer rim rests during dictation.

## Consequences

- **Positive:** dictation works for every provider (or no provider), with no
  account, no vendor endpoint and no audio leaving the machine on macOS 26
  (on-device recognition); partial text is visible while speaking.
- **Negative:** macOS-only, the first use requires two OS permissions, and
  recognition availability depends on the user's dictation settings.
- **Accepted trade-off:** choosing native over Synara's ChatGPT-session
  transcription means the feature does not depend on a Codex login — at the
  cost of platform lock-in, which matches the product direction.

## Alternatives considered

- Synara-style ChatGPT transcription (`chatgpt.com/backend-api/transcribe` with
  the Codex token): works only while Codex is signed in, sends audio to OpenAI,
  depends on an unofficial endpoint, and needs a credential-reading exception.
- `webkitSpeechRecognition`: crashes this WebView (ADR-024).
- Local Whisper or a VPS endpoint: heavier or needs infrastructure for a
  single-user, single-platform feature.
