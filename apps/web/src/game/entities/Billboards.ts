import * as THREE from "three";
import { labelTexture, wrapText } from "../assets/textures";

/** Floating name label above an avatar (canvas texture on a sprite). */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private text = "";

  constructor(name: string, private readonly accent = false) {
    const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true });
    this.sprite = new THREE.Sprite(material);
    this.sprite.renderOrder = 10;
    this.sprite.position.set(0, 2.15, 0);
    this.setText(name);
  }

  setText(name: string): void {
    if (name === this.text) return;
    this.text = name;
    const { texture, aspect } = labelTexture([name], {
      font: "600 28px system-ui, -apple-system, Segoe UI, sans-serif",
      background: this.accent ? "rgba(37,99,235,0.78)" : "rgba(15,23,42,0.62)",
      padding: 12,
      radius: 18,
    });
    const material = this.sprite.material;
    material.map?.dispose();
    material.map = texture;
    material.needsUpdate = true;
    const h = 0.3;
    this.sprite.scale.set(h * aspect, h, 1);
  }

  dispose(): void {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

/** Temporary speech bubble shown above an avatar when they chat. */
export class ChatBubble {
  readonly sprite: THREE.Sprite;
  private hideAt = 0;

  constructor() {
    const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true });
    this.sprite = new THREE.Sprite(material);
    this.sprite.visible = false;
    this.sprite.renderOrder = 11;
  }

  show(text: string, now: number, durationMs = 7000): void {
    const lines = wrapText(text, 28, 3);
    const { texture, aspect } = labelTexture(lines, {
      font: "500 26px system-ui, -apple-system, Segoe UI, sans-serif",
      color: "#0f172a",
      background: "rgba(255,255,255,0.93)",
      padding: 16,
      radius: 22,
    });
    const material = this.sprite.material;
    material.map?.dispose();
    material.map = texture;
    material.opacity = 1;
    material.needsUpdate = true;
    const h = 0.27 * lines.length + 0.12;
    this.sprite.scale.set(h * aspect, h, 1);
    this.sprite.position.set(0, 2.45 + h / 2, 0);
    this.sprite.visible = true;
    this.hideAt = now + durationMs;
  }

  update(now: number): void {
    if (!this.sprite.visible) return;
    const remaining = this.hideAt - now;
    if (remaining <= 0) this.sprite.visible = false;
    else if (remaining < 600) this.sprite.material.opacity = remaining / 600;
  }

  dispose(): void {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}
