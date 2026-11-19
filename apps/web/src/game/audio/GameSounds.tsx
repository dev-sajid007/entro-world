import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { AnimCode } from "@entroworld/game-protocol";
import { getCityLayout, getZoneLayout, type SurfaceKind } from "@entroworld/world-assets";
import type { GameEngine } from "../core/GameEngine";
import type { RemotePlayer } from "../entities/RemotePlayer";
import { sfx, type LoopHandle, type Surface } from "./Sfx";

/**
 * Metres between footsteps when the feet can't be tracked (classic or far avatars). Matches the
 * animations: about 2.9 steps a second walking and 3 running.
 */
const STRIDE = { walk: 1.5, run: 2.75 };
/** Other players' footsteps are only played this close (m). */
const REMOTE_STEPS_RANGE = 22;

const SURFACE_SOUND: Record<SurfaceKind, Surface> = {
  asphalt: "hard",
  sidewalk: "hard",
  plaza: "hard",
  concrete: "hard",
  path: "soft",
  grass: "soft",
  sand: "sand",
  wetsand: "sand",
};

/** What the ground under (x, z) sounds like: the top-most surface there, grass otherwise. */
export function surfaceSoundAt(x: number, z: number): Surface {
  let best: { y: number; kind: SurfaceKind } | null = null;
  for (const s of getCityLayout().surfaces) {
    if (x < s.rect.minX || x > s.rect.maxX || z < s.rect.minZ || z > s.rect.maxZ) continue;
    if (!best || s.y > best.y) best = { y: s.y, kind: s.kind };
  }
  return best ? SURFACE_SOUND[best.kind] : "soft";
}

/**
 * Whether a footstep sound is due this frame: when the avatar's foot touches the ground in its
 * animation, or every stride of distance when the feet can't be tracked.
 */
function stepDue(t: { travelled: number; footfalls: number | null }, footfalls: number | null, walking: boolean, moved: number, running: boolean): boolean {
  const prev = t.footfalls;
  t.footfalls = footfalls;
  if (moved > 3) {
    // Teleported.
    t.travelled = 0;
    return false;
  }
  if (!walking) {
    t.travelled = 0;
    return false;
  }
  if (footfalls !== null) return prev !== null && footfalls !== prev;
  t.travelled += moved;
  const stride = running ? STRIDE.run : STRIDE.walk;
  if (t.travelled < stride) return false;
  t.travelled -= stride;
  return true;
}

interface RemoteTrack {
  x: number;
  z: number;
  travelled: number;
  emote: string;
  footfalls: number | null;
}

/**
 * Plays the game's sounds: the player's footsteps, jumps and landings, other players' steps and
 * emotes, fountains, district ambience, and interface sounds for game events.
 */
export function GameSounds({ engine }: { engine: GameEngine }) {
  const camera = useThree((s) => s.camera);

  // Event sounds.
  useEffect(() => {
    sfx.setAmbience(getZoneLayout(engine.ui.get().zoneId).ambience);
    let lastChatId: string | null = engine.chat.get().entries.at(-1)?.id ?? null;
    const offs = [
      engine.events.on("openPanel", () => sfx.panelOpen()),
      engine.events.on("escape", () => sfx.panelClose()),
      engine.events.on("system", () => sfx.notify()),
      engine.events.on("serverError", () => sfx.error()),
      engine.events.on("academyInvite", () => sfx.notify()),
      engine.events.on("shopEnter", () => sfx.doorbell()),
      engine.events.on("zoneChanged", (zoneId) => {
        sfx.whoosh();
        sfx.setAmbience(getZoneLayout(zoneId).ambience);
      }),
      // A new message from someone else (the list is capped, so compare the newest id).
      engine.chat.subscribe(() => {
        const last = engine.chat.get().entries.at(-1);
        if (last && last.id !== lastChatId && !last.self) sfx.chat();
        lastChatId = last?.id ?? null;
      }),
    ];
    // A soft click for every button in the game's interface.
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("button, [role=button], select")) sfx.click();
    };
    document.addEventListener("click", onClick, true);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener("click", onClick, true);
    };
  }, [engine]);

  const state = useMemo(
    () => ({
      step: { x: NaN, z: NaN, travelled: 0, grounded: true, minVy: 0, seated: false, footfalls: null as number | null },
      remotes: new WeakMap<RemotePlayer, RemoteTrack>(),
      fountains: new Map<string, LoopHandle>(),
      right: new THREE.Vector3(),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const loop of state.fountains.values()) loop.stop();
      state.fountains.clear();
    },
    [state],
  );

  useFrame(() => {
    // The listener is the camera; its right vector gives left/right panning.
    state.right.setFromMatrixColumn(camera.matrixWorld, 0);
    sfx.setListener(camera.position.x, camera.position.z, state.right.x, state.right.z);

    // The local player.
    const local = engine.local;
    const s = local.character.state;
    const st = state.step;
    if (Number.isNaN(st.x)) Object.assign(st, { x: s.x, z: s.z });
    const moved = Math.hypot(s.x - st.x, s.z - st.z);
    st.x = s.x;
    st.z = s.z;
    const walking = s.grounded && s.moving && !local.seated;
    if (stepDue(st, local.rig.footfalls(), walking, moved, s.sprinting)) sfx.footstep(surfaceSoundAt(s.x, s.z), 1, 0, s.sprinting);
    if (st.grounded && !s.grounded && s.vy > 1) sfx.jump();
    if (!s.grounded) st.minVy = Math.min(st.minVy, s.vy);
    if (!st.grounded && s.grounded) {
      if (st.minVy < -3) sfx.land(Math.min(1, -st.minVy / 15), surfaceSoundAt(s.x, s.z));
      st.minVy = 0;
    }
    st.grounded = s.grounded;
    if (local.seated !== st.seated) sfx.rustle();
    st.seated = local.seated;

    // Other players: footsteps nearby and emotes.
    for (const r of engine.remotes.values()) {
      const p = r.root.position;
      let t = state.remotes.get(r);
      if (!t) {
        t = { x: p.x, z: p.z, travelled: 0, emote: r.emote, footfalls: null };
        state.remotes.set(r, t);
      }
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      t.x = p.x;
      t.z = p.z;
      const near = sfx.spatial(p.x, p.z, REMOTE_STEPS_RANGE);
      const running = r.anim === AnimCode.RUNNING;
      const walking = r.anim === AnimCode.WALKING || running;
      if (stepDue(t, r.rig.footfalls(), walking, d, running) && near.gain > 0) sfx.footstep(surfaceSoundAt(p.x, p.z), near.gain * 0.8, near.pan, running);
      if (r.emote !== t.emote) {
        if (r.emote && near.gain > 0.05) sfx.emote(r.emote);
        t.emote = r.emote;
      }
    }

    // Running fountains.
    for (const o of getCityLayout().interactives) {
      if (o.kind !== "fountain") continue;
      const on = engine.objects.get(o.id)?.active ?? true;
      let loop = state.fountains.get(o.id);
      const sp = sfx.spatial(o.x, o.z, 35);
      if (!loop) {
        if (!on || sp.gain <= 0) continue;
        loop = sfx.waterLoop();
        state.fountains.set(o.id, loop);
      }
      loop.set(on ? sp.gain * 0.35 : 0, sp.pan);
    }
  });

  return null;
}
