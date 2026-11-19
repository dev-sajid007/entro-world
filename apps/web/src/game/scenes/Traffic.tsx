import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { GameEngine } from "../core/GameEngine";
import { sfx, type LoopHandle } from "../audio/Sfx";
import { NameTag } from "../entities/Billboards";
import { Buttons } from "@entroworld/game-protocol";
import { movementDirection } from "@entroworld/game-engine";
import { avoidCars, createTraffic, stepTraffic, type Car, type Point } from "../world/traffic";
import { MODELS, MODEL_ORDER, buildModel, type CarModel, type ModelName } from "./carModels";

/** Body colours, picked per car. */
const PAINT = ["#b91c1c", "#1d4ed8", "#e5e7eb", "#111827", "#0f766e", "#ca8a04", "#6b7280"];
/** Trim levels after the model name, e.g. "Velora GT". */
const TRIMS = ["GT", "Sport", "LX", "Hybrid", "S", "XR"];
/** Car names float above cars within this distance (m). */
const LABEL_RANGE = 30;

export interface CarIdentity {
  model: ModelName;
  /** Model and trim, e.g. "Velora GT". */
  name: string;
  /** Number plate, e.g. "EW 482". */
  plate: string;
  color: string;
}

/** Name, plate and paint of a car: fixed per car id, so every player sees the same car. */
export function carIdentity(id: number): CarIdentity {
  const model = MODEL_ORDER[id % MODEL_ORDER.length]!;
  const number = ((id * 389 + 127) % 900) + 100;
  return {
    model,
    name: `${MODELS[model].label} ${TRIMS[(id * 5 + 1) % TRIMS.length]}`,
    plate: `EW ${number}`,
    color: PAINT[(id * 3) % PAINT.length]!,
  };
}

/** A number plate or name badge texture. */
function plateTexture(text: string, kind: "plate" | "badge"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d")!;
  if (kind === "plate") {
    g.fillStyle = "#f8fafc";
    g.beginPath();
    g.roundRect(2, 2, 252, 60, 8);
    g.fill();
    g.strokeStyle = "#1e293b";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#1d4ed8";
    g.fillRect(6, 6, 30, 52);
    g.fillStyle = "#ffffff";
    g.font = "bold 16px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("EW", 21, 38);
    g.fillStyle = "#0f172a";
    g.font = "bold 40px 'DejaVu Sans Mono', monospace";
    g.fillText(text.replace(/^EW /, ""), 146, 46);
  } else {
    // Chrome lettering on a transparent background.
    const grad = g.createLinearGradient(0, 12, 0, 52);
    grad.addColorStop(0, "#f8fafc");
    grad.addColorStop(0.5, "#94a3b8");
    grad.addColorStop(1, "#e2e8f0");
    g.fillStyle = grad;
    g.font = "italic bold 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(text.toUpperCase(), 128, 44);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A soft dark patch under the car (fake ambient occlusion, works without shadow maps too). */
let shadowTexture: THREE.CanvasTexture | null = null;
function contactShadow(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowTexture = new THREE.CanvasTexture(canvas);
  return shadowTexture;
}

interface SharedMaterials {
  glass: THREE.Material;
  trim: THREE.Material;
  chrome: THREE.Material;
  tire: THREE.Material;
  rim: THREE.Material;
  headlights: THREE.Material;
}

function sharedMaterials(): SharedMaterials {
  return {
    glass: new THREE.MeshPhysicalMaterial({ color: "#0b1220", roughness: 0.03, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    trim: new THREE.MeshStandardMaterial({ color: "#16181d", roughness: 0.65, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#e5e7eb", roughness: 0.12, metalness: 1, envMapIntensity: 1.5 }),
    tire: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: "#c7ccd4", roughness: 0.22, metalness: 0.95 }),
    headlights: new THREE.MeshStandardMaterial({ color: "#fffbeb", emissive: "#fff4cc", emissiveIntensity: 1.6, toneMapped: false }),
  };
}

/** One car in the scene: body, wheels, lights, plates and its name label. */
class CarView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly spinners: { group: THREE.Group; side: number }[] = [];
  private readonly steerers: THREE.Group[] = [];
  private readonly tail: THREE.MeshStandardMaterial;
  private readonly paint: THREE.MeshPhysicalMaterial;
  private readonly owned: { dispose(): void }[] = [];
  readonly tag: NameTag;
  private spin = 0;
  private steer = 0;
  private pitch = 0;
  private roll = 0;
  private prevSpeed: number;
  private prevHeading: number;

  constructor(
    readonly car: Car,
    readonly identity: CarIdentity,
    model: CarModel,
    shared: SharedMaterials,
    shadows: boolean,
  ) {
    this.paint = new THREE.MeshPhysicalMaterial({ color: identity.color, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });
    this.tail = new THREE.MeshStandardMaterial({ color: "#7f1d1d", emissive: "#ef4444", emissiveIntensity: 0.9, toneMapped: false });
    this.owned.push(this.paint, this.tail);

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadows && cast;
      m.receiveShadow = cast;
      return m;
    };
    this.body.add(
      mesh(model.paint, this.paint, true),
      mesh(model.glass, shared.glass, true),
      mesh(model.trim, shared.trim),
      mesh(model.chrome, shared.chrome),
      mesh(model.headlights, shared.headlights),
      mesh(model.taillights, this.tail),
    );

    // Number plates front and back, and the model name on the boot.
    const plateTex = plateTexture(identity.plate, "plate");
    const badgeTex = plateTexture(MODELS[identity.model].label, "badge");
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTex, transparent: true, roughness: 0.2, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const plateGeo = new THREE.PlaneGeometry(0.52, 0.13);
    const badgeGeo = new THREE.PlaneGeometry(0.6, 0.15);
    this.owned.push(plateTex, badgeTex, plateMat, badgeMat, plateGeo, badgeGeo);
    const front = new THREE.Mesh(plateGeo, plateMat);
    front.position.copy(model.plates.front);
    const rear = new THREE.Mesh(plateGeo, plateMat);
    rear.position.copy(model.plates.rear);
    rear.rotation.y = Math.PI;
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.copy(model.badge);
    badge.rotation.y = Math.PI;
    this.body.add(front, rear, badge);

    // Wheels: a steering pivot (front only) holding a spinning group. Left wheels are turned around
    // so their rims face outwards.
    for (const w of model.wheels) {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, w.y, w.z);
      const spinner = new THREE.Group();
      if (w.side < 0) spinner.rotation.y = Math.PI;
      spinner.add(mesh(model.tire, shared.tire, true), mesh(model.rim, shared.rim));
      pivot.add(spinner);
      this.root.add(pivot);
      this.spinners.push({ group: spinner, side: w.side });
      if (w.front) this.steerers.push(pivot);
    }

    const shadowGeo = new THREE.PlaneGeometry(model.spec.width + 0.6, model.spec.length + 0.6).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 });
    this.owned.push(shadowGeo, shadowMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = 1;
    this.root.add(this.body, shadow);

    this.tag = new NameTag(`${identity.name} · ${identity.plate}`);
    this.tag.sprite.position.y = model.spec.roof + 0.55;
    this.root.add(this.tag.sprite);
    this.prevHeading = car.heading;
    this.prevSpeed = car.speed;
  }

  update(dt: number, camera: THREE.Vector3, radius: number): void {
    const car = this.car;
    this.root.position.set(car.x, 0, car.z);
    this.root.rotation.y = car.heading;

    // Wheels roll with the distance driven; front wheels steer into turns.
    this.spin += (car.speed * dt) / radius;
    for (const s of this.spinners) s.group.rotation.x = s.side < 0 ? -this.spin : this.spin;
    let turn = car.heading - this.prevHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const yawRate = dt > 0 ? turn / dt : 0;
    const k = 1 - Math.exp(-dt * 8);
    this.steer += (THREE.MathUtils.clamp(yawRate * 0.45, -0.5, 0.5) - this.steer) * k;
    for (const p of this.steerers) p.rotation.y = this.steer;

    // The body dips forward when braking, rises when pulling away, and leans out of turns.
    const accel = dt > 0 ? (car.speed - this.prevSpeed) / dt : 0;
    this.pitch += (THREE.MathUtils.clamp(accel * 0.006, -0.035, 0.03) - this.pitch) * k;
    this.roll += (THREE.MathUtils.clamp(-yawRate * car.speed * 0.004, -0.04, 0.04) - this.roll) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = Math.sin(performance.now() / 160 + car.id) * 0.004 * Math.min(1, car.speed / 5);

    // Brake lights glow brighter while slowing down or stopped.
    const braking = accel < -0.5 || car.speed < 0.3;
    this.tail.emissiveIntensity += ((braking ? 3.2 : 0.9) - this.tail.emissiveIntensity) * k;

    this.tag.sprite.visible = this.root.position.distanceTo(camera) < LABEL_RANGE;
    this.prevSpeed = car.speed;
    this.prevHeading = car.heading;
  }

  dispose(): void {
    this.tag.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

/** People cars brake for: the local player and everyone else in view. */
function people(engine: GameEngine): Point[] {
  const list: Point[] = [];
  const s = engine.local.character.state;
  list.push({ x: s.x, z: s.z });
  for (const r of engine.remotes.values()) list.push({ x: r.root.position.x, z: r.root.position.z });
  return list;
}

/** Cars driving around the city's streets (decorative, see game/world/traffic). */
export function Traffic({ engine, shadows }: { engine: GameEngine; shadows: boolean }) {
  const cars = useMemo(() => createTraffic(Date.now() / 1000), []);
  const models = useMemo(() => new Map(MODEL_ORDER.map((name) => [name, buildModel(MODELS[name])])), []);
  const shared = useMemo(sharedMaterials, []);
  const group = useMemo(() => new THREE.Group(), []);
  const views = useMemo(() => {
    const list = cars.map((car) => {
      const identity = carIdentity(car.id);
      car.halfLength = MODELS[identity.model].length / 2;
      car.halfWidth = MODELS[identity.model].width / 2;
      return new CarView(car, identity, models.get(identity.model)!, shared, shadows);
    });
    for (const v of list) group.add(v.root);
    return list;
  }, [cars, models, shared, shadows, group]);

  useEffect(() => () => views.forEach((v) => v.dispose()), [views]);

  // Dev tools: the live cars, for poking at traffic from the console.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __traffic?: Car[] }).__traffic = cars;
  }, [cars]);

  // People can't walk into cars: steer the player's input around them (see avoidCars).
  useEffect(() => {
    engine.movementFilter = (x, z, buttons, yaw) => {
      const dir = movementDirection(buttons, yaw);
      if (dir.x === 0 && dir.z === 0) return { buttons, yaw };
      const d = avoidCars(cars, x, z, dir);
      if (d.x === 0 && d.z === 0) return { buttons: buttons & ~(Buttons.Forward | Buttons.Backward | Buttons.Left | Buttons.Right), yaw };
      if (d.x === dir.x && d.z === dir.z) return { buttons, yaw };
      // Turning the yaw by the angle between the two directions makes the same keys walk along `d`.
      return { buttons, yaw: yaw + Math.atan2(d.x, d.z) - Math.atan2(dir.x, dir.z) };
    };
    return () => {
      engine.movementFilter = null;
    };
  }, [engine, cars]);
  useEffect(
    () => () => {
      for (const m of models.values()) [m.paint, m.glass, m.trim, m.chrome, m.headlights, m.taillights, m.tire, m.rim].forEach((g) => g.dispose());
      Object.values(shared).forEach((m) => m.dispose());
    },
    [models, shared],
  );

  // Engine hum per car (started only within earshot), and a horn for people standing in the road.
  const engines = useMemo(() => new Map<number, LoopHandle>(), []);
  const honked = useMemo(() => new Map<number, number>(), []);
  useEffect(
    () => () => {
      for (const loop of engines.values()) loop.stop();
      engines.clear();
    },
    [engines],
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    stepTraffic(cars, people(engine), dt);
    const now = performance.now();
    for (const view of views) {
      const car = view.car;
      view.update(dt, camera.position, MODELS[view.identity.model].wheelRadius);
      const sp = sfx.spatial(car.x, car.z, 45);
      let loop = engines.get(car.id);
      if (!loop && sp.gain > 0) {
        loop = sfx.engineLoop();
        engines.set(car.id, loop);
      }
      loop?.set(sp.gain * (0.12 + 0.1 * (car.speed / car.cruise)), sp.pan, car.speed / car.cruise);
      // One short honk after a second of waiting, then at most every 5 s.
      if (car.waitingForPerson > 1 && now - (honked.get(car.id) ?? 0) > 5000) {
        honked.set(car.id, now);
        sfx.horn(car.x, car.z);
      }
    }
  });

  return <primitive object={group} />;
}
