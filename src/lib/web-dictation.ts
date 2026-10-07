/**
 * Dictation for the UI served to a phone (ADR-084): the Mac's microphone is out of
 * reach there, so the browser's own speech recognition (Siri dictation on iPhone)
 * transcribes on the device. Same shape as the native commands: start, then stop
 * with the final text.
 */
interface RecognitionResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
interface RecognitionEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function webDictationSupported(): boolean {
  return recognitionConstructor() !== null;
}

/** Joins what was said so far: final phrases, then the phrase still being heard. */
export function joinTranscript(results: ArrayLike<RecognitionResult>): { final: string; interim: string } {
  let final = "", interim = "";
  for (let index = 0; index < results.length; index += 1) {
    const text = results[index][0].transcript;
    if (results[index].isFinal) final += text; else interim += text;
  }
  return { final: final.replace(/\s+/g, " ").trim(), interim: interim.replace(/\s+/g, " ").trim() };
}

function errorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") return "Microphone permission was denied.";
  if (code === "language-not-supported") return "Speech recognition is unavailable for this language.";
  if (code === "network") return "Speech recognition is unavailable right now.";
  return "Dictation failed.";
}

/**
 * iPhone's recognizer stops hearing after the first session in continuous mode, so this
 * listens in short sessions and starts the next one while the person is still recording;
 * the phrases of every session add up.
 */
export class WebDictation {
  private recognition: Recognition | null = null;
  private listening = false;
  private earlier = "";
  private current = "";
  private ended: Promise<void> = Promise.resolve();
  private finish: () => void = () => undefined;
  private failure: string | null = null;
  private locale = "";
  private onInterim: (text: string) => void = () => undefined;

  /** Resolves once the browser is listening; `onInterim` follows the words as they come. */
  start(locale: string, onInterim: (text: string) => void): Promise<void> {
    if (!recognitionConstructor()) return Promise.reject(new Error("Speech recognition is unavailable right now."));
    this.locale = locale;
    this.onInterim = onInterim;
    this.earlier = "";
    this.current = "";
    this.failure = null;
    this.listening = true;
    this.ended = new Promise((resolve) => { this.finish = resolve; });
    try {
      this.listen();
    } catch (error) {
      this.listening = false;
      return Promise.reject(error instanceof Error ? error : new Error("Dictation could not start."));
    }
    return Promise.resolve();
  }

  private text(): string {
    return [this.earlier, this.current].filter(Boolean).join(" ");
  }

  private listen() {
    const Constructor = recognitionConstructor()!;
    const recognition = new Constructor();
    recognition.lang = this.locale;
    recognition.continuous = false;
    recognition.interimResults = true;
    this.recognition = recognition;
    recognition.onresult = (event) => {
      const { final, interim } = joinTranscript(event.results);
      this.current = final;
      this.onInterim([this.text(), interim].filter(Boolean).join(" "));
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      this.failure = errorMessage(event.error);
      // Permission refused or no service: stop instead of trying again.
      if (event.error !== "network") this.listening = false;
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.earlier = this.text();
      this.current = "";
      if (this.listening) {
        try { this.listen(); return; } catch { this.listening = false; }
      }
      this.recognition = null;
      this.finish();
    };
    recognition.start();
  }

  /** Stops listening; the final text, or nothing when cancelled. */
  async stop(cancelled: boolean): Promise<string> {
    const recognition = this.recognition;
    this.listening = false;
    if (!recognition) return cancelled ? "" : this.text();
    if (cancelled) { this.recognition = null; recognition.abort(); this.finish(); return ""; }
    recognition.stop();
    // The last phrase arrives just before `end`; give up after a few seconds.
    await Promise.race([this.ended, new Promise((resolve) => setTimeout(resolve, 4000))]);
    const text = this.text();
    if (this.failure && !text) throw new Error(this.failure);
    return text;
  }
}
