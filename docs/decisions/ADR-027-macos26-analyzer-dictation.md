# ADR-027: macOS 26 analyzer dictation (file capture, transcript on stop)

**Status:** Accepted

## Context

ADR-025 shipped dictation on `SFSpeechRecognizer` + `AVAudioEngine` streaming
partial results to the renderer. The product is now macOS-only by direction, the
target machines run macOS 26 with Apple's analyzer stack
(`SpeechAnalyzer`/`DictationTranscriber`), and the owner explicitly does not
want live transcription shown in the composer. The owner also redesigned the
dictation strip and asked that its visuals not change.

The vendored `speech` crate (Swift bridge) exposes the macOS 26
`DictationTranscriber`, a file-based engine with punctuation options, but no
streaming audio input; `SFSpeechRecognizer` remains the only streaming path.

## Decision

- `dictation.rs` records the microphone with `AVAudioEngine` into a private,
  bounded temporary `.caf` file (`switchyard-dictation-<uuid>.caf` in the OS
  temp directory, capped at 300 s) and transcribes it once on stop with
  `DictationTranscriber` (`shortForm` content hint, `punctuation`) through the
  `speech` crate. There is no `dictation` event: `stop_dictation(cancel)`
  returns `Option<String>` — the transcript on Finish, `None` on Cancel or when
  no speech was detected. Stale capture files are removed on start, after every
  stop and after crashes.
- `start_dictation(locale)` authorizes speech
  (`SpeechRecognizer::request_authorization`, mapped to the existing
  denied/timeout messages) and microphone (`AVAudioApplication`), then resolves
  the app's `pt-BR`/`en-US` pair to a `DictationTranscriber`-supported
  identifier. `dictation_status` keeps reporting authorization. Locale assets
  come from the OS.
- The Swift bridge links Swift concurrency, so the app binary needs the OS
  Swift directory on its rpath: `build.rs` emits
  `-Wl,-rpath,/usr/lib/swift`.
- The composer keeps the approved metal mic and orbital recording strip with
  clock, Cancel and Finish. Since no partial text exists, the listening caption
  stays static; Finish hands the final transcript to the composer when
  `stop_dictation` resolves, and Cancel discards the capture. The component
  changed only its data flow (subscribing to events and the `latest` ref were
  removed); no visuals changed.
- `DictationEvent`, `Client.onDictation` and the `dictation` event channel are
  removed.

## Consequences

- **Positive:** the transcript arrives once, punctuated and formatted for the
  target locale, with no partial text flickering into the composer; audio never
  leaves the machine and the capture file is deleted after transcription; the
  engine is Apple's current dictation stack with the OS-installed locale assets.
- **Negative:** macOS 26+ only (the bridge reports dictation unavailable with
  older SDK/runtime); the transcript appears only after Finish, so long
  recordings have a short transcription pause; TCC still requires the same
  code-signed bundle.
- **Accepted trade-off:** no live text by explicit product request, which is
  why the file-based engine replaces streaming `SFSpeechRecognizer`.

## Alternatives considered

- Keep streaming `SFSpeechRecognizer`: rejected — older engine, and its live
  partials are exactly what the owner does not want displayed.
- Stream analyzer audio into `SpeechAnalyzer` live input: the `speech` crate
  0.9 exposes no audio-buffer input for `DictationTranscriber`; this would
  require a custom Swift bridge.
- Synara-style ChatGPT transcription: unchanged from ADR-025 reasoning (needs
  a Codex login, sends audio to OpenAI, unofficial endpoint).
