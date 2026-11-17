import { z } from "zod";
import { ROBOT_METHODS, MAX_ACTION_LOG } from "./actions";

/**
 * Puzzle definitions are data (stored in `lessons.puzzle_definition`), so new puzzles ship without
 * a client release. Grid coordinates: `x` is the column (east = +x), `y` is the row (south = +y).
 */
export const MAX_GRID_SIZE = 8;

/**
 * Tile legend:
 * - `.` floor
 * - `#` wall (blocks movement; jumping over it is not allowed)
 * - `~` gap (blocks walking; the robot can jump over a single gap)
 * - `B` floor with a battery the robot can pick up
 */
export const TILE_CHARS = [".", "#", "~", "B"] as const;
export type TileChar = (typeof TILE_CHARS)[number];

export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Editor control blocks a puzzle offers besides robot methods. */
export const PUZZLE_CONTROLS = ["repeat"] as const;
export type PuzzleControl = (typeof PUZZLE_CONTROLS)[number];

const cellSchema = z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict();

export const puzzleDefinitionSchema = z
  .object({
    width: z.number().int().min(1).max(MAX_GRID_SIZE),
    height: z.number().int().min(1).max(MAX_GRID_SIZE),
    /** One string per row, `width` characters each. */
    tiles: z.array(z.string().regex(/^[.#~B]+$/)),
    start: cellSchema.extend({ dir: z.enum(DIRECTIONS) }).strict(),
    goal: z
      .object({
        /** Cell the robot must end on (drawn as the exit door). */
        reach: cellSchema.nullable(),
        /** Every battery must be picked up. */
        collectAll: z.boolean(),
      })
      .strict(),
    allowedApi: z.array(z.enum(ROBOT_METHODS)).min(1),
    controls: z.array(z.enum(PUZZLE_CONTROLS)),
    /** Longest accepted action log. */
    maxActions: z.number().int().min(1).max(MAX_ACTION_LOG),
    /** Editor hint: most blocks allowed in the workspace (encourages loops). Not enforced by the server. */
    maxBlocks: z.number().int().min(1).max(200).nullable(),
    /** Action count of a model solution, for "perfect" feedback. */
    par: z.number().int().min(1).nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.tiles.length !== p.height) ctx.addIssue({ code: "custom", message: `expected ${p.height} rows`, path: ["tiles"] });
    p.tiles.forEach((row, i) => {
      if (row.length !== p.width) ctx.addIssue({ code: "custom", message: `row ${i} must have ${p.width} tiles`, path: ["tiles", i] });
    });
    const walkable = (c: { x: number; y: number }) => c.x < p.width && c.y < p.height && /[.B]/.test(p.tiles[c.y]?.[c.x] ?? "#");
    if (!walkable(p.start)) ctx.addIssue({ code: "custom", message: "start must be on a floor tile", path: ["start"] });
    if (p.goal.reach && !walkable(p.goal.reach)) ctx.addIssue({ code: "custom", message: "goal must be on a floor tile", path: ["goal", "reach"] });
    if (!p.goal.reach && !p.goal.collectAll) ctx.addIssue({ code: "custom", message: "puzzle needs a goal", path: ["goal"] });
  });

export type PuzzleDefinition = z.infer<typeof puzzleDefinitionSchema>;

/** Instructions and hints shown with a lesson (`lessons.content`). */
export const lessonContentSchema = z
  .object({
    /** The programming idea the lesson teaches, e.g. "Sequences". */
    concept: z.string().max(60),
    intro: z.string().max(1000),
    instructions: z.string().max(1000),
    /** Revealed one at a time, from gentle to specific. */
    hints: z.array(z.string().max(400)).max(6),
    /** World effects applied when the puzzle is solved. */
    unlocks: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)).max(5),
  })
  .strict();

export type LessonContent = z.infer<typeof lessonContentSchema>;
