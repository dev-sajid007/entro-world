/**
 * Watches a streamed answer for leaks of the system prompt. Text is released with a small
 * hold-back so a leak is usually detected before its characters ever reach the client:
 * - the canary: a secret marker placed in the system prompt that must never appear in output;
 * - verbatim copying: several consecutive 8-word sequences taken from the system prompt.
 */
const SHINGLE = 8;
/** Matching shingles that count as a leak (3 ≈ ten words copied in a row). */
const LEAK_THRESHOLD = 3;
const HOLD_BACK = 160;

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

function shingles(list: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= list.length; i++) out.push(list.slice(i, i + SHINGLE).join(" "));
  return out;
}

export class OutputGuard {
  private readonly secret: Set<string>;
  private text = "";
  private released = 0;
  private violated = false;

  constructor(
    systemPrompt: string,
    private readonly canary: string,
  ) {
    this.secret = new Set(shingles(words(systemPrompt.replaceAll(canary, ""))));
  }

  get violation(): boolean {
    return this.violated;
  }

  /** Adds streamed text; returns the part that is safe to send now ("" once violated). */
  push(fragment: string): string {
    if (this.violated) return "";
    this.text += fragment;
    if (this.leaks(this.text)) {
      this.violated = true;
      return "";
    }
    const safeEnd = Math.max(this.released, this.text.length - HOLD_BACK);
    const out = this.text.slice(this.released, safeEnd);
    this.released = safeEnd;
    return out;
  }

  /** At the end of the answer: checks the complete text and returns whatever was held back. */
  finish(finalText?: string): string {
    if (finalText !== undefined && finalText.startsWith(this.text)) this.text = finalText;
    if (this.violated || this.leaks(this.text)) {
      this.violated = true;
      return "";
    }
    const out = this.text.slice(this.released);
    this.released = this.text.length;
    return out;
  }

  private leaks(text: string): boolean {
    if (text.includes(this.canary)) return true;
    let hits = 0;
    for (const s of shingles(words(text))) if (this.secret.has(s) && ++hits >= LEAK_THRESHOLD) return true;
    return false;
  }
}
