import * as THREE from "three";
import { createRng } from "@entroworld/shared";
import type { FacadeStyle, SurfaceKind } from "@entroworld/world-assets";

/**
 * Procedurally generated textures. Everything is drawn into canvases at startup so the world
 * needs no downloaded image assets. Textures are cached and shared across the scene.
 */

const cache = new Map<string, THREE.Texture>();

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = opts.anisotropy ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, amount: number, size = 1): void {
  const rng = createRng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const n = (rng() - 0.5) * amount;
      for (let yy = 0; yy < size && y + yy < h; yy++) {
        for (let xx = 0; xx < size && x + xx < w; xx++) {
          const i = ((y + yy) * w + (x + xx)) * 4;
          d[i] = Math.max(0, Math.min(255, d[i]! + n));
          d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
          d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, colors: string[], count: number, maxR: number): void {
  const rng = createRng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)]!;
    ctx.globalAlpha = 0.25 + rng() * 0.5;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 0.4 + rng() * maxR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Ground surface textures. The texture repeats every `SURFACE_TILE[kind]` meters. */
export const SURFACE_TILE: Record<SurfaceKind, number> = {
  asphalt: 8,
  sidewalk: 3,
  plaza: 4,
  grass: 6,
  sand: 6,
  wetsand: 6,
  path: 4,
  concrete: 4,
};

export function surfaceTexture(kind: SurfaceKind): THREE.Texture {
  const key = `surface:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const [c, ctx] = canvas(S, S);
  switch (kind) {
    case "asphalt": {
      ctx.fillStyle = "#4a4d52";
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 11, 26, 2);
      speckle(ctx, S, S, 12, ["#5f6369", "#3a3c40", "#6b6e73"], 900, 1.4);
      // A few patches and cracks.
      const rng = createRng(13);
      ctx.strokeStyle = "rgba(25,25,28,0.45)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let x = rng() * S;
        let y = rng() * S;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (rng() - 0.5) * 40;
          y += (rng() - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "sidewalk":
    case "concrete": {
      ctx.fillStyle = kind === "sidewalk" ? "#b9b4aa" : "#aaa69e";
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 21, 18, 2);
      ctx.strokeStyle = "rgba(80,76,70,0.55)";
      ctx.lineWidth = 3;
      const n = kind === "sidewalk" ? 2 : 4;
      for (let i = 0; i <= n; i++) {
        const p = (i / n) * S;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, S);
        ctx.moveTo(0, p);
        ctx.lineTo(S, p);
        ctx.stroke();
      }
      speckle(ctx, S, S, 22, ["#8d887f", "#cfcac0"], 500, 1.2);
      break;
    }
    case "plaza": {
      ctx.fillStyle = "#c8b9a2";
      ctx.fillRect(0, 0, S, S);
      const rng = createRng(31);
      const tile = S / 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const shade = 185 + Math.floor(rng() * 40);
          ctx.fillStyle = `rgb(${shade},${shade - 12},${shade - 30})`;
          const off = y % 2 === 0 ? 0 : tile / 2;
          ctx.fillRect(((x * tile + off) % S) + 2, y * tile + 2, tile - 4, tile - 4);
          if (off) ctx.fillRect(-tile / 2 + 2, y * tile + 2, tile - 4, tile - 4);
        }
      }
      noise(ctx, S, S, 32, 14, 2);
      break;
    }
    case "path": {
      ctx.fillStyle = "#b8a17d";
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 41, 30, 2);
      speckle(ctx, S, S, 42, ["#8f7a58", "#d6c4a3", "#9c8b6d"], 2500, 1.8);
      break;
    }
    case "grass": {
      ctx.fillStyle = "#5b7f3a";
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 51, 34, 4);
      speckle(ctx, S, S, 52, ["#6f9446", "#4c6e30", "#7da552", "#557a35"], 5000, 2.2);
      const rng = createRng(53);
      ctx.strokeStyle = "rgba(140,180,90,0.35)";
      for (let i = 0; i < 1800; i++) {
        const x = rng() * S;
        const y = rng() * S;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 4);
        ctx.stroke();
      }
      break;
    }
    case "sand":
    case "wetsand": {
      ctx.fillStyle = kind === "sand" ? "#e3cf9f" : "#c2a979";
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 61, 22, 2);
      speckle(ctx, S, S, 62, ["#f2e2b8", "#cdb27c", "#bfa36d"], 4000, 1.2);
      break;
    }
  }
  const tex = finish(c);
  cache.set(key, tex);
  return tex;
}

export interface FacadeSpec {
  /** Width/height in meters covered by one repetition of the texture. */
  tileWidth: number;
  tileHeight: number;
  roughness: number;
  metalness: number;
}

export const FACADE_SPECS: Record<FacadeStyle, FacadeSpec> = {
  glass: { tileWidth: 12, tileHeight: 14, roughness: 0.25, metalness: 0.55 },
  office: { tileWidth: 12, tileHeight: 14, roughness: 0.75, metalness: 0.1 },
  brick: { tileWidth: 9, tileHeight: 12, roughness: 0.9, metalness: 0 },
  stucco: { tileWidth: 9, tileHeight: 12, roughness: 0.85, metalness: 0 },
  shop: { tileWidth: 8, tileHeight: 7, roughness: 0.8, metalness: 0.05 },
  hall: { tileWidth: 16, tileHeight: 17, roughness: 0.35, metalness: 0.4 },
  house: { tileWidth: 6, tileHeight: 3.4, roughness: 0.85, metalness: 0 },
};

/**
 * Facade textures are drawn in near-white so a per-building vertex color can tint the walls,
 * while windows stay dark and glossy. Returns [color map, roughness map].
 */
export function facadeTextures(style: FacadeStyle): [THREE.Texture, THREE.Texture] {
  const key = `facade:${style}`;
  const hit = cache.get(key);
  const hitR = cache.get(`${key}:rough`);
  if (hit && hitR) return [hit, hitR];
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const [rc, rctx] = canvas(S, S);
  const rng = createRng(style.length * 977);

  const wall = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, S);
    rctx.fillStyle = "#e6e6e6";
    rctx.fillRect(0, 0, S, S);
  };
  const windowRect = (x: number, y: number, w: number, h: number, frame: number) => {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    const tint = 40 + Math.floor(rng() * 50);
    g.addColorStop(0, `rgb(${tint},${tint + 20},${tint + 38})`);
    g.addColorStop(0.55, `rgb(${tint + 55},${tint + 75},${tint + 95})`);
    g.addColorStop(1, `rgb(${tint + 10},${tint + 25},${tint + 40})`);
    if (frame > 0) {
      ctx.fillStyle = "#d9d9d9";
      ctx.fillRect(x - frame, y - frame, w + frame * 2, h + frame * 2);
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Occasional blinds / lit room.
    if (rng() < 0.25) {
      ctx.fillStyle = rng() < 0.5 ? "rgba(235,225,200,0.55)" : "rgba(255,240,200,0.35)";
      ctx.fillRect(x, y, w, h * (0.2 + rng() * 0.6));
    }
    rctx.fillStyle = "#1a1a1a";
    rctx.fillRect(x, y, w, h);
  };

  switch (style) {
    case "glass": {
      wall("#f2f2f2");
      const cols = 4;
      const rows = 4;
      const cw = S / cols;
      const rh = S / rows;
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) windowRect(k * cw + 3, r * rh + 6, cw - 6, rh - 12, 0);
      // Spandrel bands.
      ctx.fillStyle = "rgba(200,205,210,0.9)";
      for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh, S, 6);
      break;
    }
    case "office":
    case "hall": {
      wall("#f0eee9");
      const cols = style === "hall" ? 8 : 4;
      const rows = 4;
      const cw = S / cols;
      const rh = S / rows;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) windowRect(k * cw + cw * 0.14, r * rh + rh * 0.2, cw * 0.72, rh * 0.55, 0);
      }
      break;
    }
    case "brick": {
      wall("#f3ece6");
      // Brick courses.
      ctx.strokeStyle = "rgba(120,110,105,0.35)";
      ctx.lineWidth = 1;
      for (let y = 0; y < S; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(S, y);
        ctx.stroke();
        for (let x = (y / 8) % 2 === 0 ? 0 : 12; x < S; x += 24) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 8);
          ctx.stroke();
        }
      }
      noise(ctx, S, S, 71, 16, 4);
      const cols = 3;
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) windowRect(k * (S / cols) + 34, r * (S / rows) + 30, S / cols - 68, S / rows - 58, 5);
      }
      break;
    }
    case "stucco": {
      wall("#f7f3ec");
      noise(ctx, S, S, 81, 10, 3);
      const cols = 3;
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const x = k * (S / cols) + 30;
          const y = r * (S / rows) + 28;
          windowRect(x, y, S / cols - 60, S / rows - 60, 6);
          // Balcony rail.
          ctx.fillStyle = "rgba(90,90,90,0.8)";
          ctx.fillRect(x - 8, y + S / rows - 58, S / cols - 44, 5);
        }
      }
      break;
    }
    case "shop": {
      // Ground floor storefront: tile = 8 m wide, 7 m tall (upper floor windows in the top half).
      wall("#f5f1ea");
      noise(ctx, S, S, 91, 8, 3);
      const half = S / 2;
      // Upper floor windows.
      windowRect(40, 50, 150, 130, 6);
      windowRect(S - 190, 50, 150, 130, 6);
      // Awning band.
      ctx.fillStyle = "#e8e3da";
      ctx.fillRect(0, half - 10, S, 22);
      // Large storefront glazing with a door.
      windowRect(18, half + 30, S - 160, half - 40, 4);
      ctx.fillStyle = "#3b3b3b";
      ctx.fillRect(S - 120, half + 30, 90, half - 30);
      ctx.fillStyle = "#c9b27c";
      ctx.fillRect(S - 52, half + 120, 8, 30);
      rctx.fillStyle = "#555";
      rctx.fillRect(S - 120, half + 30, 90, half - 30);
      break;
    }
    case "house": {
      wall("#f6f2eb");
      // Horizontal siding.
      ctx.strokeStyle = "rgba(150,140,130,0.35)";
      for (let y = 0; y < S; y += 14) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(S, y);
        ctx.stroke();
      }
      windowRect(S / 2 - 90, S * 0.25, 180, S * 0.38, 10);
      break;
    }
  }
  const tex = finish(c);
  const rough = finish(rc, { srgb: false });
  cache.set(key, tex);
  cache.set(`${key}:rough`, rough);
  return [tex, rough];
}

export function roofTexture(): THREE.Texture {
  const hit = cache.get("roof");
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = "#9b9890";
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, 101, 30, 2);
  speckle(ctx, S, S, 102, ["#7d7a72", "#b5b2aa"], 900, 1.5);
  const tex = finish(c);
  cache.set("roof", tex);
  return tex;
}

export function waterNormalTexture(): THREE.Texture {
  const hit = cache.get("water-normal");
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  // Sum of a few sine waves, converted to a tangent-space normal map. Tileable by construction.
  const height = (x: number, y: number) =>
    Math.sin((x / S) * Math.PI * 2 * 3 + Math.sin((y / S) * Math.PI * 2 * 2) * 1.2) * 0.5 +
    Math.sin((y / S) * Math.PI * 2 * 5 + (x / S) * Math.PI * 2 * 2) * 0.3 +
    Math.sin(((x + y) / S) * Math.PI * 2 * 7) * 0.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      const nx = -dx * 2;
      const ny = -dy * 2;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(c, { srgb: false });
  cache.set("water-normal", tex);
  return tex;
}

/** Atlas of storefront signs. Returns the texture and a lookup of UV rects per sign text. */
export function signAtlas(names: string[]): { texture: THREE.Texture; uv: Map<string, [number, number, number, number]> } {
  const key = `signs:${names.join("|")}`;
  const cellW = 512;
  const cellH = 96;
  const cols = 2;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const [c, ctx] = canvas(cellW * cols, cellH * rows);
  const uv = new Map<string, [number, number, number, number]>();
  const palette = ["#1e3a5f", "#7c2d12", "#14532d", "#3b0764", "#0f172a", "#7f1d1d", "#134e4a"];
  names.forEach((name, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    ctx.fillStyle = palette[i % palette.length]!;
    ctx.fillRect(x, y, cellW, cellH);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
    ctx.fillStyle = "#fdf6e3";
    ctx.font = "bold 52px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x + cellW / 2, y + cellH / 2 + 2, cellW - 40);
    const W = cellW * cols;
    const H = cellH * rows;
    uv.set(name, [x / W, 1 - (y + cellH) / H, (x + cellW) / W, 1 - y / H]);
  });
  const texture = finish(c, { repeat: false });
  texture.flipY = true;
  cache.set(key, texture);
  return { texture, uv };
}

/** Text label rendered into a sprite-ready texture (name tags, chat bubbles, screens). */
export function labelTexture(
  lines: string[],
  opts: { font?: string; color?: string; background?: string; padding?: number; maxWidth?: number; radius?: number } = {},
): { texture: THREE.CanvasTexture; aspect: number } {
  const font = opts.font ?? "600 30px system-ui, -apple-system, Segoe UI, sans-serif";
  const padding = opts.padding ?? 14;
  const maxWidth = opts.maxWidth ?? 520;
  const [measureCanvas, m] = canvas(8, 8);
  void measureCanvas;
  m.font = font;
  const lineHeight = parseInt(/(\d+)px/.exec(font)?.[1] ?? "30", 10) * 1.25;
  const width = Math.min(maxWidth, Math.max(...lines.map((l) => m.measureText(l).width))) + padding * 2;
  const height = lineHeight * lines.length + padding * 1.4;
  const [c, ctx] = canvas(Math.ceil(width), Math.ceil(height));
  if (opts.background) {
    ctx.fillStyle = opts.background;
    const r = opts.radius ?? 16;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, r);
    ctx.fill();
  }
  ctx.font = font;
  ctx.fillStyle = opts.color ?? "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => ctx.fillText(line, c.width / 2, padding * 0.7 + lineHeight * (i + 0.5), maxWidth));
  const texture = finish(c, { repeat: false, anisotropy: 4 });
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, aspect: c.width / c.height };
}

/** Wraps text to lines no longer than `maxChars`. */
export function wrapText(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line);
      line = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
      if (lines.length >= maxLines) break;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, maxChars - 1)}…`;
  }
  return lines;
}

/**
 * Derives a tangent-space normal map from a canvas texture's brightness (dark = recessed): mortar
 * lines, paving joints, cracks and window frames pick up real light and shadow. Tileable when the
 * source tiles. `strength` scales the slopes.
 */
export function normalMapFrom(source: THREE.Texture, strength: number): THREE.Texture {
  const key = `normal:${source.uuid}:${strength}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = source.image as HTMLCanvasElement;
  const w = img.width;
  const h = img.height;
  const src = img.getContext("2d")!.getImageData(0, 0, w, h).data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = (0.299 * src[i * 4]! + 0.587 * src[i * 4 + 1]! + 0.114 * src[i * 4 + 2]!) / 255;
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]!;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel gradient with wrap-around.
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      out.data[o] = (nx * 0.5 + 0.5) * 255;
      out.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = finish(c, { srgb: false, repeat: source.wrapS === THREE.RepeatWrapping });
  tex.repeat.copy(source.repeat);
  cache.set(key, tex);
  return tex;
}
