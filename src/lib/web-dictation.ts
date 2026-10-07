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

export class WebDictation {
  private recognition: Recognition | null = null;
  private text = "";
  private ended: Promise<void> = Promise.resolve();
  private failure: string | null = null;

  /** Resolves once the browser is listening; `onInterim` follows the words as they come. */
  start(locale: string, onInterim: (text: string) => void): Promise<void> {
    const Constructor = recognitionConstructor();
    if (!Constructor) return Promise.reject(new Error("Speech recognition is unavailable right now."));
    const recognition = new Constructor();
    recognition.lang = locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    this.recognition = recognition;
    this.text = "";
    this.failure = null;
    let finish: () => void = () => undefined;
    this.ended = new Promise((resolve) => { finish = resolve; });
    recognition.onresult = (event) => {
      const { final, interim } = joinTranscript(event.results);
      this.text = final;
      onInterim([final, interim].filter(Boolean).join(" "));
    };
    recognition.onerror = (event) => { if (event.error !== "aborted" && event.error !== "no-speech") this.failure = errorMessage(event.error); };
    recognition.onend = () => finish();
    try {
      recognition.start();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("Dictation could not start."));
    }
    return Promise.resolve();
  }

  /** Stops listening; the final text, or nothing when cancelled. */
  async stop(cancelled: boolean): Promise<string> {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return "";
    if (cancelled) { recognition.abort(); return ""; }
    recognition.stop();
    // The last phrase arrives just before `end`; give up after a few seconds.
    await Promise.race([this.ended, new Promise((resolve) => setTimeout(resolve, 4000))]);
    if (this.failure && !this.text) throw new Error(this.failure);
    return this.text;
  }
}
