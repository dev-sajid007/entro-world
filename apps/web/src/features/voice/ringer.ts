/**
 * Call sounds generated with Web Audio (no audio files): a two-tone ring for incoming calls, a
 * softer ring-back while calling, and a short tone on hang-up.
 */
export class Ringer {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private context(): AudioContext | null {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(freqs: number[], start: number, duration: number, volume: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.setValueAtTime(volume, t0 + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    gain.connect(ctx.destination);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + duration);
    }
  }

  start(kind: "incoming" | "outgoing"): void {
    this.stop();
    const ring = () => {
      if (kind === "incoming") {
        this.tone([660, 880], 0, 0.35, 0.12);
        this.tone([660, 880], 0.5, 0.35, 0.12);
      } else {
        this.tone([440, 480], 0, 1.2, 0.05);
      }
    };
    ring();
    this.timer = setInterval(ring, kind === "incoming" ? 2000 : 3000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  hangupTone(): void {
    this.tone([480], 0, 0.15, 0.08);
    this.tone([360], 0.18, 0.25, 0.08);
  }
}
