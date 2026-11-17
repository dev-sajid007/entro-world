import { z } from "zod";

/**
 * The robot companion's API (SPEC-ADDENDUM-01 §4.3). User code calls these inside the browser
 * sandbox; every call that changes the world is recorded as a {@link RobotAction}. Sensors only read
 * the simulation and are never part of the action log.
 */
export const ROBOT_ACTION_METHODS = ["moveForward", "turnLeft", "turnRight", "jump", "pickUp", "drop", "say"] as const;
export const ROBOT_SENSOR_METHODS = ["isPathClear", "sensor"] as const;
export const ROBOT_METHODS = [...ROBOT_ACTION_METHODS, ...ROBOT_SENSOR_METHODS] as const;

export type RobotActionMethod = (typeof ROBOT_ACTION_METHODS)[number];
export type RobotSensorMethod = (typeof ROBOT_SENSOR_METHODS)[number];
export type RobotMethod = (typeof ROBOT_METHODS)[number];

export type SensorDirection = "front" | "left" | "right";
export type SensorReading = "empty" | "wall" | "item";

/** Largest step count of a single `moveForward` call. */
export const MAX_STEPS_PER_MOVE = 10;
export const MAX_SAY_LENGTH = 80;
/** Hard cap on any action log, whatever the puzzle allows (keeps requests and replays small). */
export const MAX_ACTION_LOG = 500;

export const robotActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("moveForward"), steps: z.number().int().min(1).max(MAX_STEPS_PER_MOVE) }).strict(),
  z.object({ type: z.literal("turnLeft") }).strict(),
  z.object({ type: z.literal("turnRight") }).strict(),
  z.object({ type: z.literal("jump") }).strict(),
  z.object({ type: z.literal("pickUp") }).strict(),
  z.object({ type: z.literal("drop") }).strict(),
  z.object({ type: z.literal("say"), text: z.string().max(MAX_SAY_LENGTH) }).strict(),
]);

export type RobotAction = z.infer<typeof robotActionSchema>;

export const EDITOR_MODES = ["blocks", "split", "code"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

export const lessonAttemptRequestSchema = z
  .object({
    actions: z.array(robotActionSchema).max(MAX_ACTION_LOG),
    editorMode: z.enum(EDITOR_MODES),
  })
  .strict();

export type LessonAttemptRequest = z.infer<typeof lessonAttemptRequestSchema>;

/** Why a replayed attempt failed. `blocked` = the robot drove into a wall, a gap or off the grid. */
export type AttemptFailureReason = "goal_not_reached" | "invalid_action" | "too_many_actions" | "blocked";

export interface LessonAttemptResponse {
  success: boolean;
  failureReason?: AttemptFailureReason;
  /** XP granted by this attempt (0 when the lesson was already completed). */
  xpAwarded: number;
  /** Slugs of badges earned by this attempt. */
  badgesAwarded: string[];
  /** World effects to apply, e.g. `door-academy-lab-open`. */
  worldEffects: string[];
  /** True when this attempt completed the lesson for the first time. */
  firstCompletion: boolean;
  actionCount: number;
}

/** Draft code saved per lesson. Blocks mode stores the serialized Blockly workspace. */
export const MAX_DRAFT_CODE_LENGTH = 50_000;
export const saveCodeRequestSchema = z
  .object({
    code: z.string().max(MAX_DRAFT_CODE_LENGTH),
    editorMode: z.enum(EDITOR_MODES),
  })
  .strict();

export type SaveCodeRequest = z.infer<typeof saveCodeRequestSchema>;
