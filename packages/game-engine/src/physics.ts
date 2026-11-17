import RAPIER from "@dimforge/rapier3d-compat";
import { Buttons, AnimCode } from "@entroworld/game-protocol";
import { getCityLayout, type CityLayout, type Collider as LayoutCollider } from "@entroworld/world-assets";
import { CHARACTER_CENTER_Y, GROUP_CHARACTER, GROUP_WORLD, SIM, groups } from "./constants";

let initPromise: Promise<typeof RAPIER> | null = null;

/** Loads the Rapier WASM module once per process / page. */
export function initPhysics(): Promise<typeof RAPIER> {
  initPromise ??= RAPIER.init().then(() => RAPIER);
  return initPromise;
}

export interface CharacterState {
  /** Feet position (meters). */
  x: number;
  y: number;
  z: number;
  /** Vertical velocity (m/s). */
  vy: number;
  grounded: boolean;
  /** Body facing yaw (radians). */
  facing: number;
  moving: boolean;
  sprinting: boolean;
  /** Seconds since the character last touched the ground. */
  airTime: number;
}

export interface CharacterSnapshot {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  facing: number;
}

export function createCharacterState(x: number, y: number, z: number, facing = 0): CharacterState {
  return { x, y, z, vy: 0, grounded: false, facing, moving: false, sprinting: false, airTime: 0 };
}

export class Character {
  constructor(
    readonly collider: RAPIER.Collider,
    readonly state: CharacterState,
  ) {}

  snapshot(): CharacterSnapshot {
    const s = this.state;
    return { x: s.x, y: s.y, z: s.z, vy: s.vy, grounded: s.grounded, facing: s.facing };
  }

  restore(snap: CharacterSnapshot): void {
    const s = this.state;
    s.x = snap.x;
    s.y = snap.y;
    s.z = snap.z;
    s.vy = snap.vy;
    s.grounded = snap.grounded;
    s.facing = snap.facing;
  }

  teleport(x: number, y: number, z: number, facing?: number): void {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vy = 0;
    s.airTime = 0;
    if (facing !== undefined) s.facing = facing;
  }
}

/** Movement direction in world space for the given buttons and camera yaw (unit vector or zero). */
export function movementDirection(buttons: number, yaw: number): { x: number; z: number } {
  let ix = 0;
  let iz = 0;
  if (buttons & Buttons.Forward) iz -= 1;
  if (buttons & Buttons.Backward) iz += 1;
  if (buttons & Buttons.Left) ix -= 1;
  if (buttons & Buttons.Right) ix += 1;
  if (ix === 0 && iz === 0) return { x: 0, z: 0 };
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const wx = ix * cos + iz * sin;
  const wz = -ix * sin + iz * cos;
  const len = Math.hypot(wx, wz);
  return { x: wx / len, z: wz / len };
}

export function deriveAnimation(state: CharacterState): number {
  if (!state.grounded && state.airTime > SIM.coyoteTime) return state.vy > 0.5 ? AnimCode.JUMPING : AnimCode.FALLING;
  if (!state.grounded && state.vy > 2) return AnimCode.JUMPING;
  if (state.moving) return state.sprinting ? AnimCode.RUNNING : AnimCode.WALKING;
  return AnimCode.IDLE;
}

/**
 * A Rapier world containing the static city colliders, plus a kinematic character controller.
 * Used identically by the client (prediction) and the server (authority).
 */
export class PhysicsWorld {
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly characters = new Set<Character>();

  private constructor(
    readonly rapier: typeof RAPIER,
    readonly world: RAPIER.World,
    readonly controller: RAPIER.KinematicCharacterController,
  ) {}

  static async create(layout: CityLayout = getCityLayout()): Promise<PhysicsWorld> {
    const R = await initPhysics();
    const world = new R.World({ x: 0, y: SIM.gravity, z: 0 });
    world.timestep = SIM.dt;
    const worldGroups = groups(GROUP_WORLD, 0xffff);
    // Ground, tiled: very large cuboids lose f32 precision in shape casts and let characters sink.
    const tile = 50;
    for (let x = -300; x < 300; x += tile * 2) {
      for (let z = -200; z < 200; z += tile * 2) {
        world.createCollider(R.ColliderDesc.cuboid(tile, 1, tile).setTranslation(x + tile, -1, z + tile).setCollisionGroups(worldGroups));
      }
    }
    for (const c of layout.colliders) world.createCollider(colliderDesc(R, c).setCollisionGroups(worldGroups));
    // Build the broad-phase acceleration structure for scene queries.
    world.step();

    const controller = world.createCharacterController(SIM.controllerOffset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    controller.enableAutostep(SIM.maxStepHeight, 0.2, false);
    controller.enableSnapToGround(SIM.snapToGround);
    controller.setMaxSlopeClimbAngle((SIM.maxSlopeClimbDeg * Math.PI) / 180);
    controller.setMinSlopeSlideAngle(((SIM.maxSlopeClimbDeg + 5) * Math.PI) / 180);
    controller.setApplyImpulsesToDynamicBodies(false);
    return new PhysicsWorld(R, world, controller);
  }

  /** Number of ground tiles created in addition to the layout colliders. */
  static readonly GROUND_TILES = 24;

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  createCharacter(x: number, y: number, z: number, facing = 0): Character {
    const R = this.rapier;
    const desc = R.ColliderDesc.capsule(SIM.capsuleHalfHeight, SIM.capsuleRadius)
      .setTranslation(x, y + CHARACTER_CENTER_Y, z)
      .setCollisionGroups(groups(GROUP_CHARACTER, GROUP_WORLD));
    const collider = this.world.createCollider(desc);
    const character = new Character(collider, createCharacterState(x, y, z, facing));
    this.characters.add(character);
    return character;
  }

  removeCharacter(character: Character): void {
    if (!this.characters.delete(character)) return;
    this.world.removeCollider(character.collider, false);
  }

  /** Advances one character by one fixed step of input. Deterministic for identical inputs and state. */
  stepCharacter(character: Character, buttons: number, yaw: number, dt: number = SIM.dt): void {
    const s = character.state;
    const dir = movementDirection(buttons, yaw);
    const moving = dir.x !== 0 || dir.z !== 0;
    const sprinting = moving && (buttons & Buttons.Sprint) !== 0;
    const speed = moving ? (sprinting ? SIM.runSpeed : SIM.walkSpeed) : 0;

    if ((buttons & Buttons.Jump) !== 0 && (s.grounded || s.airTime < SIM.coyoteTime) && s.vy <= 0) {
      s.vy = SIM.jumpSpeed;
      s.grounded = false;
      s.airTime = SIM.coyoteTime;
    }
    s.vy = Math.max(-SIM.maxFallSpeed, s.vy + SIM.gravity * dt);

    this.desired.x = dir.x * speed * dt;
    this.desired.y = s.vy * dt;
    this.desired.z = dir.z * speed * dt;

    const collider = character.collider;
    collider.setTranslation({ x: s.x, y: s.y + CHARACTER_CENTER_Y, z: s.z });
    this.controller.computeColliderMovement(
      collider,
      this.desired,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(GROUP_CHARACTER, GROUP_WORLD),
    );
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();

    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    collider.setTranslation({ x: s.x, y: s.y + CHARACTER_CENTER_Y, z: s.z });

    if (grounded) {
      if (s.vy < 0) s.vy = 0;
      s.airTime = 0;
    } else {
      s.airTime += dt;
      // Bumped into a ceiling while moving up.
      if (s.vy > 0 && m.y < this.desired.y * 0.5) s.vy = 0;
    }
    s.grounded = grounded;
    s.moving = moving;
    s.sprinting = sprinting;
    if (moving) s.facing = Math.atan2(-dir.x, -dir.z);
  }

  /** Casts a ray straight down and returns the ground height below a point (or null). */
  groundHeight(x: number, z: number, fromY = 50): number | null {
    const R = this.rapier;
    const ray = new R.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 10, true, undefined, groups(GROUP_CHARACTER, GROUP_WORLD));
    return hit ? fromY - hit.timeOfImpact : null;
  }

  dispose(): void {
    this.characters.clear();
    this.controller.free();
    this.world.free();
  }
}

function colliderDesc(R: typeof RAPIER, c: LayoutCollider): RAPIER.ColliderDesc {
  if (c.kind === "box") {
    const half = c.rotation / 2;
    return R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
      .setTranslation(c.x, c.y, c.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
  }
  return R.ColliderDesc.cylinder(c.halfHeight, c.radius).setTranslation(c.x, c.y, c.z);
}
