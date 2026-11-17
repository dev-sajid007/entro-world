import { Buttons } from "@entroworld/game-protocol";
import { Emitter } from "../core/Emitter";

export type InputAction = "interact" | "chat" | "escape" | "emote1" | "emote2" | "emote3" | "emote4" | "emote5" | "emote6" | "emote7" | "emote8" | "toggleHelp" | "toggleVoice";

const KEY_BUTTONS: Record<string, number> = {
  KeyW: Buttons.Forward,
  ArrowUp: Buttons.Forward,
  KeyS: Buttons.Backward,
  ArrowDown: Buttons.Backward,
  KeyA: Buttons.Left,
  ArrowLeft: Buttons.Left,
  KeyD: Buttons.Right,
  ArrowRight: Buttons.Right,
  Space: Buttons.Jump,
  ShiftLeft: Buttons.Sprint,
  ShiftRight: Buttons.Sprint,
};

const KEY_ACTIONS: Record<string, InputAction> = {
  KeyE: "interact",
  KeyF: "interact",
  Enter: "chat",
  KeyT: "chat",
  Escape: "escape",
  Digit1: "emote1",
  Digit2: "emote2",
  Digit3: "emote3",
  Digit4: "emote4",
  Digit5: "emote5",
  Digit6: "emote6",
  Digit7: "emote7",
  Digit8: "emote8",
  KeyH: "toggleHelp",
  KeyV: "toggleVoice",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Keyboard, mouse (pointer lock or drag), wheel and touch input. Produces a button bitmask each
 * simulation step and accumulates look deltas for the camera. Never touches React state.
 */
export class InputManager extends Emitter<{ action: InputAction; pointerLock: boolean }> {
  private keyButtons = 0;
  private virtualButtons = 0;
  private joystick = { x: 0, y: 0 };
  private lookDX = 0;
  private lookDY = 0;
  private zoomDelta = 0;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private element: HTMLElement | null = null;
  private enabled = true;
  /** Set when any movement key is pressed (used to stand up from seats / cancel emotes). */
  movementIntent = false;

  attach(element: HTMLElement): void {
    this.element = element;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    element.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    if (this.element) {
      this.element.removeEventListener("mousedown", this.onMouseDown);
      this.element.removeEventListener("wheel", this.onWheel);
      this.element.removeEventListener("contextmenu", this.onContextMenu);
    }
    if (document.pointerLockElement) document.exitPointerLock();
    this.element = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.onBlur();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element && this.element !== null;
  }

  requestPointerLock(): void {
    if (!this.element || this.pointerLocked) return;
    const result = this.element.requestPointerLock?.() as unknown;
    if (result instanceof Promise) result.catch(() => undefined);
  }

  /** Current button bitmask (keyboard + virtual buttons + joystick). */
  buttons(): number {
    if (!this.enabled) return 0;
    let b = this.keyButtons | this.virtualButtons;
    if (this.joystick.y < -0.35) b |= Buttons.Forward;
    if (this.joystick.y > 0.35) b |= Buttons.Backward;
    if (this.joystick.x < -0.35) b |= Buttons.Left;
    if (this.joystick.x > 0.35) b |= Buttons.Right;
    if (Math.hypot(this.joystick.x, this.joystick.y) > 0.92) b |= Buttons.Sprint;
    return b;
  }

  /** Returns and resets accumulated look movement in pixels. */
  consumeLook(): { dx: number; dy: number; zoom: number } {
    const out = { dx: this.lookDX, dy: this.lookDY, zoom: this.zoomDelta };
    this.lookDX = 0;
    this.lookDY = 0;
    this.zoomDelta = 0;
    return out;
  }

  /** Touch controls (from the HUD's virtual joystick and buttons). */
  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
    if (Math.hypot(x, y) > 0.35) this.movementIntent = true;
  }

  setVirtualButton(button: number, pressed: boolean): void {
    this.virtualButtons = pressed ? this.virtualButtons | button : this.virtualButtons & ~button;
  }

  addLook(dx: number, dy: number): void {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  addZoom(delta: number): void {
    this.zoomDelta += delta;
  }

  trigger(action: InputAction): void {
    this.emit("action", action);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || isTypingTarget(e.target)) return;
    const button = KEY_BUTTONS[e.code];
    if (button !== undefined) {
      this.keyButtons |= button;
      if (button & (Buttons.Forward | Buttons.Backward | Buttons.Left | Buttons.Right | Buttons.Jump)) this.movementIntent = true;
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      return;
    }
    const action = KEY_ACTIONS[e.code];
    if (action && !e.repeat) {
      if (action === "chat") e.preventDefault();
      this.emit("action", action);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const button = KEY_BUTTONS[e.code];
    if (button !== undefined) this.keyButtons &= ~button;
  };

  private onBlur = (): void => {
    this.keyButtons = 0;
    this.virtualButtons = 0;
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.dragging = false;
  };

  private onPointerLockChange = (): void => {
    this.emit("pointerLock", this.pointerLocked);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (e.button === 0 && !this.pointerLocked && !("ontouchstart" in window && navigator.maxTouchPoints > 0)) {
      this.requestPointerLock();
    }
    if (!this.pointerLocked) {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    } else if (this.dragging) {
      this.lookDX += e.clientX - this.lastPointer.x;
      this.lookDY += e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomDelta += Math.sign(e.deltaY);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
