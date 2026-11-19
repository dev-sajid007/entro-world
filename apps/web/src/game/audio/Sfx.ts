import type { ZoneLayout } from "@entroworld/world-assets";

/**
 * Game sound effects, synthesized with Web Audio: no audio files to download or license.
 *
 * Three buses (effects, interface, ambience) feed a master gain that the player controls (mute
 * and volume, remembered per browser). Browsers only allow audio after a user gesture, so the
 * context starts on the first click or key press. World sounds are positional: quieter with
 * distance and panned left/right relative to the camera.
 */

export type Ambience = ZoneLayout["ambience"];
export type Surface = "hard" | "soft" | "sand" | "wood";

interface Settings {
  muted: boolean;
  volume: number;
}

const SETTINGS_KEY = "ew:sfx";
/** World sounds fade out completely beyond this distance (m). */
const HEARING_RANGE = 40;

interface ToneOptions {
  type?: OscillatorType;
  /** Glide to this frequency over the sound's duration. */
  slideTo?: number;
  attack?: number;
  delay?: number;
  pan?: number;
  bus?: "sfx" | "ui";
}

interface NoiseOptions {
  filter?: BiquadFilterType;
  freq?: number;
  q?: number;
  slideTo?: number;
  attack?: number;
  delay?: number;
  pan?: number;
  bus?: "sfx" | "ui";
}

/** A continuous sound (engine hum, fountain) whose level and pitch are set every frame. */
export interface LoopHandle {
  set(gain: number, pan: number, rate?: number): void;
  stop(): void;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Settings>;
      return { muted: v.muted === true, volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : 0.7 };
    }
  } catch {
    // Storage unavailable: defaults.
  }
  return { muted: false, volume: 0.7 };
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: { sfx: GainNode; ui: GainNode; ambient: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings = loadSettings();
  private listeners = new Set<() => void>();
  /** Listener pose: camera position and its right vector on the ground plane. */
  private listener = { x: 0, z: 0, rx: 1, rz: 0 };
  private ambience: { kind: Ambience; stop: () => void } | null = null;
  private wantedAmbience: Ambience | null = null;
  private ambienceTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      this.start();
      if (this.ctx?.state === "running") {
        window.removeEventListener("pointerdown", unlock, true);
        window.removeEventListener("keydown", unlock, true);
      }
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  // -----------------------------------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------------------------------

  get muted(): boolean {
    return this.settings.muted;
  }

  get volume(): number {
    return this.settings.volume;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** A stable snapshot for useSyncExternalStore. */
  getSnapshot = (): Settings => this.settings;

  setMuted(muted: boolean): void {
    this.update({ muted });
  }

  setVolume(volume: number): void {
    this.update({ volume: Math.min(1, Math.max(0, volume)), muted: false });
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Not remembered this time.
    }
    this.applyVolume();
    this.listeners.forEach((fn) => fn());
  }

  private applyVolume(): void {
    if (!this.ctx || !this.master) return;
    const target = this.settings.muted ? 0 : this.settings.volume * this.settings.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  // -----------------------------------------------------------------------------------------------
  // Context
  // -----------------------------------------------------------------------------------------------

  private start(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = 0;
        // A gentle limiter keeps stacked sounds from clipping.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.ratio.value = 6;
        master.connect(limiter).connect(ctx.destination);
        const bus = (level: number) => {
          const g = ctx.createGain();
          g.gain.value = level;
          g.connect(master);
          return g;
        };
        this.buses = { sfx: bus(0.9), ui: bus(0.6), ambient: bus(0.45) };
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buffer;
        this.ctx = ctx;
        this.master = master;
        this.applyVolume();
        if (this.wantedAmbience) this.setAmbience(this.wantedAmbience);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** The running context, or null (not unlocked yet, unsupported, or muted to silence). */
  private live(): AudioContext | null {
    if (!this.ctx || this.ctx.state !== "running" || this.settings.muted) return null;
    return this.ctx;
  }

  private output(bus: "sfx" | "ui" | "ambient", pan: number): AudioNode {
    const ctx = this.ctx!;
    const target = this.buses![bus];
    if (pan === 0) return target;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(target);
    return panner;
  }

  // -----------------------------------------------------------------------------------------------
  // Primitives
  // -----------------------------------------------------------------------------------------------

  tone(freq: number, duration: number, volume: number, o: ToneOptions = {}): void {
    const ctx = this.live();
    if (!ctx || volume <= 0.001) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const attack = o.attack ?? 0.005;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.output(o.bus ?? "sfx", o.pan ?? 0));
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  noise(duration: number, volume: number, o: NoiseOptions = {}): void {
    const ctx = this.live();
    if (!ctx || !this.noiseBuffer || volume <= 0.001) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // Start somewhere random in the buffer so repeated sounds differ.
    const offset = Math.random() * 1.5;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter ?? "bandpass";
    filter.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.slideTo) filter.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + duration);
    filter.Q.value = o.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + (o.attack ?? 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.output(o.bus ?? "sfx", o.pan ?? 0));
    src.start(t0, offset, duration + 0.05);
  }

  // -----------------------------------------------------------------------------------------------
  // Positional helpers
  // -----------------------------------------------------------------------------------------------

  setListener(x: number, z: number, rightX: number, rightZ: number): void {
    const len = Math.hypot(rightX, rightZ) || 1;
    this.listener = { x, z, rx: rightX / len, rz: rightZ / len };
  }

  /** Gain (0..1) and stereo pan for a sound at (x, z). */
  spatial(x: number, z: number, range = HEARING_RANGE): { gain: number; pan: number } {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    if (d >= range) return { gain: 0, pan: 0 };
    const gain = Math.pow(1 - d / range, 2);
    const pan = d < 0.5 ? 0 : ((dx * this.listener.rx + dz * this.listener.rz) / d) * 0.8;
    return { gain, pan };
  }

  // -----------------------------------------------------------------------------------------------
  // Player and world sounds
  // -----------------------------------------------------------------------------------------------

  /**
   * One shoe step: a soft heel thud, then the sole rolling onto the ground a moment later. Each step
   * varies a little in pitch and level so a walk doesn't sound like a loop.
   */
  footstep(surface: Surface, loudness = 1, pan = 0, running = false): void {
    const v = loudness * (running ? 0.2 : 0.14) * (0.85 + Math.random() * 0.3);
    const pitch = 0.88 + Math.random() * 0.24;
    // Running lands flatter: heel and sole are closer together.
    const roll = running ? 0.022 : 0.04;
    switch (surface) {
      case "hard":
        this.noise(0.05, v, { filter: "lowpass", freq: 1100 * pitch, q: 0.9, pan });
        this.tone(95 * pitch, 0.07, v * 0.45, { slideTo: 60, pan });
        this.noise(0.035, v * 0.4, { filter: "bandpass", freq: 2100 * pitch, q: 0.8, delay: roll, pan });
        break;
      case "wood":
        this.noise(0.06, v, { filter: "bandpass", freq: 650 * pitch, q: 1.4, pan });
        this.tone(150 * pitch, 0.1, v * 0.4, { slideTo: 110, pan });
        this.noise(0.04, v * 0.35, { filter: "bandpass", freq: 1600 * pitch, q: 1, delay: roll, pan });
        break;
      case "sand":
        this.noise(0.08, v * 0.6, { filter: "lowpass", freq: 500 * pitch, q: 0.7, attack: 0.008, pan });
        this.noise(0.16, v * 0.55, { filter: "bandpass", freq: 1900 * pitch, q: 0.6, attack: 0.02, delay: roll * 0.5, pan });
        break;
      case "soft":
        this.noise(0.09, v * 0.75, { filter: "lowpass", freq: 520 * pitch, q: 0.7, attack: 0.006, pan });
        this.noise(0.1, v * 0.25, { filter: "highpass", freq: 3600 * pitch, q: 0.5, attack: 0.02, delay: roll, pan });
        break;
    }
  }

  jump(): void {
    this.noise(0.22, 0.12, { filter: "bandpass", freq: 500, slideTo: 1800, q: 0.8, attack: 0.03 });
  }

  land(strength: number, surface: Surface): void {
    const v = Math.min(1, 0.4 + strength);
    this.noise(0.14, 0.3 * v, { filter: "lowpass", freq: surface === "sand" ? 1800 : 700, q: 0.8 });
    this.tone(90, 0.12, 0.25 * v, { type: "sine", slideTo: 50 });
  }

  /** Clothes rustling (sitting down, standing up). */
  rustle(): void {
    this.noise(0.25, 0.1, { filter: "bandpass", freq: 3000, q: 0.6, attack: 0.05 });
  }

  emote(kind: string): void {
    switch (kind) {
      case "clap":
        for (let i = 0; i < 4; i++) this.noise(0.06, 0.25, { filter: "bandpass", freq: 1800, q: 1, delay: i * 0.22 });
        break;
      case "cheer":
        this.noise(0.6, 0.12, { filter: "bandpass", freq: 1200, slideTo: 1800, q: 2, attack: 0.08 });
        this.chime([784, 988, 1175], 0.06, 0.18);
        break;
      case "laugh":
        for (let i = 0; i < 4; i++) this.tone(420 - i * 25, 0.1, 0.07, { type: "triangle", delay: i * 0.13 });
        break;
      case "wave":
      case "bow":
        this.noise(0.3, 0.07, { filter: "bandpass", freq: 2500, q: 0.6, attack: 0.08 });
        break;
      default:
        this.chime([660, 880], 0.08, 0.1);
    }
  }

  splash(x: number, z: number): void {
    const s = this.spatial(x, z, 50);
    this.noise(0.8, 0.35 * s.gain, { filter: "lowpass", freq: 2500, slideTo: 600, q: 0.6, attack: 0.02, pan: s.pan });
  }

  /** Whoosh: fast travel and zone changes. */
  whoosh(): void {
    this.noise(0.9, 0.22, { filter: "bandpass", freq: 300, slideTo: 3000, q: 1.5, attack: 0.25, bus: "ui" });
  }

  /** A car horn, from a car at (x, z). */
  horn(x: number, z: number): void {
    const s = this.spatial(x, z, 60);
    if (s.gain <= 0) return;
    for (const f of [392, 494]) this.tone(f, 0.35, 0.09 * s.gain, { type: "square", pan: s.pan, attack: 0.01 });
  }

  // -----------------------------------------------------------------------------------------------
  // Interface sounds
  // -----------------------------------------------------------------------------------------------

  chime(freqs: number[], volume = 0.1, spacing = 0.08, bus: "sfx" | "ui" = "ui"): void {
    freqs.forEach((f, i) => this.tone(f, 0.45, volume, { type: "sine", delay: i * spacing, bus }));
  }

  click(): void {
    this.tone(1400, 0.035, 0.05, { type: "triangle", bus: "ui" });
  }

  panelOpen(): void {
    this.tone(520, 0.12, 0.07, { type: "sine", slideTo: 780, bus: "ui" });
  }

  panelClose(): void {
    this.tone(700, 0.1, 0.06, { type: "sine", slideTo: 460, bus: "ui" });
  }

  chat(): void {
    this.tone(880, 0.09, 0.05, { type: "sine", bus: "ui" });
    this.tone(1320, 0.12, 0.04, { type: "sine", delay: 0.06, bus: "ui" });
  }

  notify(): void {
    this.chime([660, 990], 0.08, 0.1);
  }

  error(): void {
    this.tone(220, 0.18, 0.08, { type: "square", slideTo: 160, bus: "ui" });
  }

  /** The shop door bell. */
  doorbell(): void {
    this.chime([1319, 1047], 0.08, 0.16);
  }

  success(): void {
    this.chime([523, 659, 784, 1047], 0.1, 0.09);
  }

  failure(): void {
    this.tone(330, 0.25, 0.08, { type: "triangle", slideTo: 220, bus: "ui" });
    this.tone(247, 0.35, 0.07, { type: "triangle", slideTo: 165, delay: 0.18, bus: "ui" });
  }

  countdown(final: boolean): void {
    this.tone(final ? 1046 : 660, final ? 0.4 : 0.15, 0.1, { type: "square", bus: "ui" });
  }

  fanfare(): void {
    this.chime([523, 659, 784], 0.09, 0.12);
    this.chime([1047, 1319], 0.1, 0.12);
    this.tone(1568, 0.6, 0.08, { delay: 0.5, bus: "ui" });
  }

  // -----------------------------------------------------------------------------------------------
  // Puzzle Lab robot
  // -----------------------------------------------------------------------------------------------

  robot(event: "move" | "turn" | "jump" | "pickUp" | "drop" | "say" | "blocked", pan = 0, gain = 1): void {
    const v = 0.9 * gain;
    switch (event) {
      case "move":
        this.tone(180, 0.25, 0.05 * v, { type: "sawtooth", slideTo: 240, pan, attack: 0.04 });
        this.noise(0.25, 0.04 * v, { filter: "bandpass", freq: 900, q: 3, pan, attack: 0.04 });
        break;
      case "turn":
        this.tone(320, 0.18, 0.05 * v, { type: "sawtooth", slideTo: 420, pan, attack: 0.03 });
        break;
      case "jump":
        this.tone(300, 0.35, 0.09 * v, { type: "sine", slideTo: 900, pan });
        break;
      case "pickUp":
        this.chime([988, 1319], 0.09 * v, 0.07, "sfx");
        break;
      case "drop":
        this.tone(660, 0.2, 0.08 * v, { type: "triangle", slideTo: 330, pan });
        break;
      case "say":
        for (let i = 0; i < 4; i++) this.tone(600 + Math.random() * 600, 0.07, 0.05 * v, { type: "square", delay: i * 0.09, pan });
        break;
      case "blocked":
        this.tone(140, 0.25, 0.14 * v, { type: "square", slideTo: 80, pan });
        this.noise(0.12, 0.15 * v, { filter: "lowpass", freq: 800, pan });
        break;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Loops
  // -----------------------------------------------------------------------------------------------

  /** A continuous engine hum (cars). `rate` (0..1+) raises the pitch with speed. */
  engineLoop(): LoopHandle {
    return this.loop((ctx, out) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 45;
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = 30;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 260;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(out);
      osc.start();
      sub.start();
      return {
        rate: (r: number) => {
          osc.frequency.setTargetAtTime(40 + r * 35, ctx.currentTime, 0.2);
          sub.frequency.setTargetAtTime(28 + r * 20, ctx.currentTime, 0.2);
        },
        stop: () => {
          osc.stop();
          sub.stop();
        },
      };
    });
  }

  /** Running water (fountains). */
  waterLoop(): LoopHandle {
    return this.loop((ctx, out) => {
      const src = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1400;
      filter.Q.value = 0.4;
      src.connect(filter).connect(out);
      src.start();
      return { rate: () => undefined, stop: () => src.stop() };
    });
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private loop(build: (ctx: AudioContext, out: AudioNode) => { rate: (r: number) => void; stop: () => void }): LoopHandle {
    let nodes: { gain: GainNode; panner: StereoPannerNode; rate: (r: number) => void; stop: () => void } | null = null;
    const ensure = () => {
      if (nodes || !this.ctx || this.ctx.state !== "running") return nodes;
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createStereoPanner();
      gain.connect(panner).connect(this.buses!.sfx);
      nodes = { gain, panner, ...build(ctx, gain) };
      return nodes;
    };
    return {
      set: (g, pan, rate) => {
        // Silent loops are not started at all (most of the city is out of earshot).
        if (g <= 0.001 && !nodes) return;
        const n = ensure();
        if (!n || !this.ctx) return;
        const t = this.ctx.currentTime;
        n.gain.gain.setTargetAtTime(Math.max(0, g), t, 0.1);
        n.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
        if (rate !== undefined) n.rate(rate);
      },
      stop: () => {
        if (!nodes) return;
        try {
          nodes.stop();
        } catch {
          // Already stopped.
        }
        nodes.gain.disconnect();
        nodes = null;
      },
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Ambience
  // -----------------------------------------------------------------------------------------------

  /** Crossfades to the background sound of a district. */
  setAmbience(kind: Ambience): void {
    this.wantedAmbience = kind;
    const ctx = this.ctx;
    if (!ctx || !this.buses || !this.noiseBuffer) return;
    if (this.ambience?.kind === kind) return;
    this.ambience?.stop();
    if (this.ambienceTimer) clearInterval(this.ambienceTimer);
    this.ambienceTimer = null;

    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    bed.connect(this.buses.ambient);
    const sources: AudioScheduledSourceNode[] = [];

    /** A filtered noise layer, optionally swelling slowly (waves, wind). */
    const layer = (filterType: BiquadFilterType, freq: number, level: number, swell = 0, swellRate = 0.1) => {
      const src = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(filter).connect(g).connect(bed);
      src.start(0, Math.random() * 1.5);
      sources.push(src);
      if (swell > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = swellRate;
        const depth = ctx.createGain();
        depth.gain.value = swell;
        lfo.connect(depth).connect(g.gain);
        lfo.start();
        sources.push(lfo);
      }
    };
    /** Occasional one-shot details (birds, distant horns, gulls), every few seconds. */
    const details = (play: () => void, everyMs: number) => {
      this.ambienceTimer = setInterval(() => {
        if (Math.random() < 0.6) play();
      }, everyMs);
    };
    const bird = (gain = 0.04) => {
      const base = 2500 + Math.random() * 1800;
      const notes = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        const f = base * (0.9 + Math.random() * 0.25);
        this.ambientTone(f, 0.09, gain, { slideTo: f * (1.15 + Math.random() * 0.3), delay: i * 0.12, pan: Math.random() * 1.6 - 0.8 });
      }
    };

    switch (kind) {
      case "urban":
        layer("lowpass", 220, 0.5);
        layer("bandpass", 900, 0.06, 0.04, 0.05);
        details(() => this.horn(this.listener.x + (Math.random() - 0.5) * 120, this.listener.z + (Math.random() - 0.5) * 120), 9000);
        break;
      case "plaza":
        // A distant crowd murmur.
        layer("bandpass", 450, 0.18, 0.06, 0.13);
        layer("lowpass", 180, 0.25);
        details(() => bird(0.025), 7000);
        break;
      case "nature":
      case "residential":
        layer("lowpass", 400, 0.12, 0.08, 0.07);
        layer("highpass", 5000, 0.015, 0.012, 0.11);
        details(() => bird(kind === "nature" ? 0.05 : 0.035), kind === "nature" ? 3000 : 5000);
        break;
      case "beach":
        // Waves: a slow swell of low and mid noise.
        layer("lowpass", 500, 0.35, 0.3, 0.09);
        layer("bandpass", 1600, 0.06, 0.05, 0.09);
        details(() => {
          const f = 1400 + Math.random() * 300;
          this.ambientTone(f, 0.35, 0.03, { slideTo: f * 0.7, pan: Math.random() * 1.4 - 0.7 });
        }, 8000);
        break;
      case "event":
        layer("bandpass", 380, 0.22, 0.1, 0.2);
        layer("lowpass", 120, 0.3, 0.1, 2);
        break;
    }
    this.ambience = {
      kind,
      stop: () => {
        const t = ctx.currentTime;
        bed.gain.setTargetAtTime(0, t, 0.6);
        setTimeout(() => {
          for (const s of sources) {
            try {
              s.stop();
            } catch {
              // Already stopped.
            }
          }
          bed.disconnect();
        }, 3000);
      },
    };
  }

  private ambientTone(freq: number, duration: number, volume: number, o: { slideTo?: number; delay?: number; pan?: number }): void {
    const ctx = this.live();
    if (!ctx || !this.buses) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = o.pan ?? 0;
    osc.connect(gain).connect(panner).connect(this.buses.ambient);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }
}

/** The game's one sound engine. */
export const sfx = new SoundEngine();
