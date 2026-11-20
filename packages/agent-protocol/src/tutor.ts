import { z } from "zod";
import { cleanAgentText } from "./messages";

/**
 * AI tutor hints in the Coding Academy (SPEC-ADDENDUM-01 §3.3 "AI Tutor NPC"). Byte, the Code Corner
 * mentor, visits the Puzzle Lab and gives a hint for the current puzzle. Hints are one-shot: they
 * are not stored as a conversation, and the learner's code is only sent when they agree to share it.
 */

export const TUTOR_QUESTION_MAX_LENGTH = 500;
/** Longest program sent to the tutor (block programs are compiled to JavaScript first). */
export const TUTOR_CODE_MAX_LENGTH = 6000;
/** Earlier hints from this lesson visit, so the tutor goes one step further instead of repeating. */
export const TUTOR_MAX_PREVIOUS_HINTS = 3;

/** How the learner's last run ended, as the tutor needs to know it. */
export const TUTOR_RUN_OUTCOMES = ["solved", "blocked_wall", "blocked_gap", "blocked_edge", "goal_not_reached", "batteries_left", "too_many_actions", "invalid_action", "error", "timeout"] as const;
export type TutorRunOutcome = (typeof TUTOR_RUN_OUTCOMES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .transform(cleanAgentText)
    .pipe(z.string().max(max))
    .optional();

/** POST /academy/lessons/:id/tutor (client -> API). */
export const tutorHintRequestSchema = z
  .object({
    /** What the learner asks, if anything ("why does my robot hit the wall?"). */
    question: optionalText(TUTOR_QUESTION_MAX_LENGTH),
    /** The learner's program as JavaScript; omitted unless they agreed to share it. */
    code: z.string().max(TUTOR_CODE_MAX_LENGTH).optional(),
    editorMode: z.enum(["blocks", "split", "code"]),
    lastRun: z
      .object({
        outcome: z.enum(TUTOR_RUN_OUTCOMES),
        /** The sandbox's error message for `error`. */
        detail: optionalText(200),
        actionCount: z.number().int().min(0).max(500),
      })
      .strict()
      .optional(),
    previousHints: z.array(z.string().max(1200)).max(TUTOR_MAX_PREVIOUS_HINTS).default([]),
  })
  .strict();
export type TutorHintRequest = z.input<typeof tutorHintRequestSchema>;
export type TutorHintInput = z.output<typeof tutorHintRequestSchema>;

/** The lesson as the API describes it to the tutor. Built from the database, never from the client. */
export const tutorLessonContextSchema = z
  .object({
    title: z.string().max(200),
    concept: z.string().max(60),
    instructions: z.string().max(1000),
    /** The lesson's own hints, gentle to specific. */
    hints: z.array(z.string().max(400)).max(6),
    /** The board drawn as text, one row per line, with a legend. */
    board: z.string().max(2000),
    allowedApi: z.array(z.string().max(40)).max(20),
    controls: z.array(z.string().max(40)).max(10),
    maxBlocks: z.number().int().nullable(),
    maxActions: z.number().int(),
  })
  .strict();
export type TutorLessonContext = z.infer<typeof tutorLessonContextSchema>;

/** API -> AI agent service (internal). */
export const internalTutorRequestSchema = z
  .object({
    userId: z.uuid(),
    lesson: tutorLessonContextSchema,
    request: z
      .object({
        question: z.string().max(TUTOR_QUESTION_MAX_LENGTH).optional(),
        code: z.string().max(TUTOR_CODE_MAX_LENGTH).optional(),
        editorMode: z.enum(["blocks", "split", "code"]),
        lastRun: z
          .object({ outcome: z.enum(TUTOR_RUN_OUTCOMES), detail: z.string().max(200).optional(), actionCount: z.number().int().min(0).max(500) })
          .strict()
          .optional(),
        previousHints: z.array(z.string().max(1200)).max(TUTOR_MAX_PREVIOUS_HINTS),
      })
      .strict(),
  })
  .strict();
export type InternalTutorRequest = z.infer<typeof internalTutorRequestSchema>;

/** Shop whose shopkeeper doubles as the Academy tutor. */
export const TUTOR_SHOP_SLUG = "code-corner";
/** Product the tutor's usage is billed to. */
export const TUTOR_PRODUCT_SLUG = "puzzle-tutor";
