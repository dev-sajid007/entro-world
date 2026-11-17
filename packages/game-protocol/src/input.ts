/** Input button bitmask. Clients send inputs, never positions. */
export const Buttons = {
  Forward: 1 << 0,
  Backward: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Sprint: 1 << 5,
} as const;

export const ALL_BUTTONS = 0b111111;

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}

/** One fixed simulation step of input. */
export interface InputFrame {
  /** Monotonic sequence number, used for server reconciliation. */
  seq: number;
  /** Button bitmask (see `Buttons`). */
  buttons: number;
  /** Camera yaw in radians; movement is relative to the camera. */
  yaw: number;
}

export function encodeButtons(input: PlayerInput): number {
  return (
    (input.forward ? Buttons.Forward : 0) |
    (input.backward ? Buttons.Backward : 0) |
    (input.left ? Buttons.Left : 0) |
    (input.right ? Buttons.Right : 0) |
    (input.jump ? Buttons.Jump : 0) |
    (input.sprint ? Buttons.Sprint : 0)
  );
}

export function decodeButtons(buttons: number): PlayerInput {
  return {
    forward: (buttons & Buttons.Forward) !== 0,
    backward: (buttons & Buttons.Backward) !== 0,
    left: (buttons & Buttons.Left) !== 0,
    right: (buttons & Buttons.Right) !== 0,
    jump: (buttons & Buttons.Jump) !== 0,
    sprint: (buttons & Buttons.Sprint) !== 0,
  };
}
