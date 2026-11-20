import type { Direction, PuzzleDefinition } from "@entroworld/robot-api";

const FACING: Record<Direction, string> = { N: "up (north)", E: "right (east)", S: "down (south)", W: "left (west)" };

/**
 * The puzzle's start board as text, for the AI tutor: one line per row (top row first) and a
 * legend. Row and column numbers start at 0.
 */
export function describeBoard(puzzle: PuzzleDefinition): string {
  const { start, goal } = puzzle;
  const rows = puzzle.tiles.map((row, y) =>
    [...row]
      .map((tile, x) => {
        if (x === start.x && y === start.y) return "R";
        if (goal.reach && x === goal.reach.x && y === goal.reach.y) return "E";
        return tile;
      })
      .join(""),
  );
  const batteries = puzzle.tiles.join("").split("B").length - 1;
  return [
    ...rows,
    "",
    "Legend: R robot, E exit door, # wall, ~ gap (can be jumped), B battery, . floor.",
    `The robot starts at column ${start.x}, row ${start.y}, facing ${FACING[start.dir]}.`,
    `To solve it: ${[goal.reach ? `end on the exit door at column ${goal.reach.x}, row ${goal.reach.y}` : null, goal.collectAll ? `pick up all ${batteries} batteries` : null].filter(Boolean).join(" and ")}.`,
  ].join("\n");
}
