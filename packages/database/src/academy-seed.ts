import {
  lessonContentSchema,
  puzzleDefinitionSchema,
  type BadgeCriteria,
  type LessonContent,
  type PuzzleDefinition,
  type RobotAction,
  type TrackLevel,
} from "@entroworld/robot-api";
import type { DbExecutor } from "./client";
import { badges, learningTracks, lessons } from "./schema";

/**
 * Coding Academy curriculum (SPEC-ADDENDUM-01 §3.2). Content lives in the database; this file is
 * only the seed. Each lesson carries a reference `solution` that tests replay to prove the puzzle
 * is solvable. Solutions are never written to the database or sent to clients.
 */

export interface LessonSeed {
  slug: string;
  title: string;
  xpReward: number;
  content: LessonContent;
  puzzle: PuzzleDefinition;
  solution: RobotAction[];
}

export interface TrackSeed {
  slug: string;
  title: string;
  description: string;
  level: TrackLevel;
  orderIndex: number;
  lessons: LessonSeed[];
}

const move = (steps: number): RobotAction => ({ type: "moveForward", steps });
const L: RobotAction = { type: "turnLeft" };
const R: RobotAction = { type: "turnRight" };
const PICK: RobotAction = { type: "pickUp" };
const times = (n: number, body: RobotAction[]): RobotAction[] => Array.from({ length: n }, () => body).flat();

const MOVE_AND_TURN = ["moveForward", "turnLeft", "turnRight"] as const;
const EXIT = "academy-lab-exit-open";

export const PROGRAMMING_BASICS: TrackSeed = {
  slug: "programming-basics",
  title: "Programming Basics",
  description: "Program your robot companion with blocks: sequences first, then loops.",
  level: "beginner",
  orderIndex: 0,
  lessons: [
    {
      slug: "hello-robot",
      title: "Hello, Robot",
      xpReward: 50,
      content: {
        concept: "Sequences",
        intro: "Meet your robot companion! A program is a list of instructions the robot follows in order, one after another.",
        instructions: "Drive the robot to the glowing exit door at the end of the corridor.",
        hints: [
          "Drag a \"move forward\" block under \"when run\".",
          "Count the tiles between the robot and the door. That's how many steps it needs.",
          "One \"move forward 4 steps\" block is enough.",
        ],
        unlocks: [EXIT],
      },
      puzzle: {
        width: 5,
        height: 3,
        tiles: ["#####", ".....", "#####"],
        start: { x: 0, y: 1, dir: "E" },
        goal: { reach: { x: 4, y: 1 }, collectAll: false },
        allowedApi: ["moveForward"],
        controls: [],
        maxActions: 10,
        maxBlocks: null,
        par: 1,
      },
      solution: [move(4)],
    },
    {
      slug: "turn-the-corner",
      title: "Turn the Corner",
      xpReward: 50,
      content: {
        concept: "Sequences",
        intro: "Robots can't walk through walls. To follow a path, combine moves with turns. Order matters!",
        instructions: "Follow the corridor around its corners to reach the exit door.",
        hints: [
          "Turns happen on the spot: the robot rotates but doesn't move.",
          "\"Turn right\" means the robot's right, not yours. Imagine sitting inside it.",
          "Move 3, turn right, move 3, turn left, move 1.",
        ],
        unlocks: [EXIT],
      },
      puzzle: {
        width: 5,
        height: 5,
        tiles: ["#####", "....#", "###.#", "###.#", "###.."],
        start: { x: 0, y: 1, dir: "E" },
        goal: { reach: { x: 4, y: 4 }, collectAll: false },
        allowedApi: [...MOVE_AND_TURN],
        controls: [],
        maxActions: 15,
        maxBlocks: null,
        par: 5,
      },
      solution: [move(3), R, move(3), L, move(1)],
    },
    {
      slug: "battery-pickup",
      title: "Battery Pickup",
      xpReward: 75,
      content: {
        concept: "Sequences",
        intro: "Robots can interact with the world, not just move. Pick up the battery on the way to the door.",
        instructions: "Collect the battery, then reach the exit door.",
        hints: [
          "\"Pick up\" only works while the robot stands on the battery's tile.",
          "Go up the corridor first, pick up, then turn toward the door.",
          "Move 4, pick up, turn right, move 3.",
        ],
        unlocks: [EXIT],
      },
      puzzle: {
        width: 5,
        height: 5,
        tiles: ["#B...", "#.###", "#.###", "#.###", "#.###"],
        start: { x: 1, y: 4, dir: "N" },
        goal: { reach: { x: 4, y: 0 }, collectAll: true },
        allowedApi: [...MOVE_AND_TURN, "pickUp"],
        controls: [],
        maxActions: 15,
        maxBlocks: null,
        par: 4,
      },
      solution: [move(4), PICK, R, move(3)],
    },
    {
      slug: "around-the-fountain",
      title: "Around the Fountain",
      xpReward: 100,
      content: {
        concept: "Loops",
        intro: "When you notice yourself writing the same blocks again and again, a loop can repeat them for you.",
        instructions: "Walk around the fountain and pick up the battery at every corner. You only have 4 blocks!",
        hints: [
          "Each side of the fountain looks the same: move, pick up, turn.",
          "Put the blocks for one side inside a \"repeat\" block.",
          "repeat 4 times: move forward 4, pick up, turn right.",
        ],
        unlocks: [EXIT],
      },
      puzzle: {
        width: 5,
        height: 5,
        tiles: ["B...B", ".###.", ".###.", ".###.", "B...B"],
        start: { x: 0, y: 4, dir: "N" },
        goal: { reach: null, collectAll: true },
        allowedApi: [...MOVE_AND_TURN, "pickUp"],
        controls: ["repeat"],
        maxActions: 30,
        maxBlocks: 4,
        par: 12,
      },
      solution: times(4, [move(4), PICK, R]),
    },
    {
      slug: "staircase",
      title: "Staircase",
      xpReward: 100,
      content: {
        concept: "Loops",
        intro: "Loops shine when a pattern repeats. Spot the pattern in the staircase and let the loop do the climbing.",
        instructions: "Climb down the staircase to the exit door using at most 5 blocks.",
        hints: [
          "Look at one step of the staircase: which moves and turns does it take?",
          "One step is: move 1, turn right, move 1, turn left.",
          "Repeat that step 4 times.",
        ],
        unlocks: [EXIT],
      },
      puzzle: {
        width: 5,
        height: 5,
        tiles: ["..###", "#..##", "##..#", "###..", "####."],
        start: { x: 0, y: 0, dir: "E" },
        goal: { reach: { x: 4, y: 4 }, collectAll: false },
        allowedApi: [...MOVE_AND_TURN],
        controls: ["repeat"],
        maxActions: 40,
        maxBlocks: 5,
        par: 16,
      },
      solution: times(4, [move(1), R, move(1), L]),
    },
  ],
};

export const ACADEMY_TRACKS: TrackSeed[] = [PROGRAMMING_BASICS];

export const ACADEMY_BADGES: { slug: string; name: string; description: string; criteria: BadgeCriteria }[] = [
  { slug: "first-steps", name: "First Steps", description: "Solved your first Academy puzzle.", criteria: { type: "lessons_completed", count: 1 } },
  {
    slug: "loop-learner",
    name: "Loop Learner",
    description: "Solved every loop puzzle in Programming Basics.",
    criteria: { type: "lessons_set", lessons: ["around-the-fountain", "staircase"] },
  },
  {
    slug: "basics-graduate",
    name: "Basics Graduate",
    description: "Completed the Programming Basics track.",
    criteria: { type: "track_completed", track: "programming-basics" },
  },
];

/** Idempotently creates the Academy tracks, lessons and badges (content updates are applied). */
export async function seedAcademy(db: DbExecutor): Promise<void> {
  for (const track of ACADEMY_TRACKS) {
    const values = { slug: track.slug, title: track.title, description: track.description, level: track.level, orderIndex: track.orderIndex, isPublished: true };
    const [row] = await db
      .insert(learningTracks)
      .values(values)
      .onConflictDoUpdate({ target: learningTracks.slug, set: values })
      .returning({ id: learningTracks.id });
    const trackId = row!.id;
    for (const [orderIndex, lesson] of track.lessons.entries()) {
      // Fail loudly on malformed content rather than seeding a broken puzzle.
      const content = lessonContentSchema.parse(lesson.content);
      const puzzleDefinition = puzzleDefinitionSchema.parse(lesson.puzzle);
      const lessonValues = { trackId, slug: lesson.slug, title: lesson.title, content, puzzleDefinition, xpReward: lesson.xpReward, orderIndex };
      await db
        .insert(lessons)
        .values(lessonValues)
        .onConflictDoUpdate({ target: [lessons.trackId, lessons.slug], set: lessonValues });
    }
  }
  for (const badge of ACADEMY_BADGES) {
    await db.insert(badges).values(badge).onConflictDoUpdate({ target: badges.slug, set: badge });
  }
}
