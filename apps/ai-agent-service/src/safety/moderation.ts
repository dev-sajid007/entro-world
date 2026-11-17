/**
 * Heuristic input/output moderation. This is a baseline that catches obvious attacks cheaply and
 * deterministically before any model call; the system prompt rules and the output guard are the
 * other layers. A classifier-based moderator can replace it behind the same interface.
 */

export type InjectionKind = "prompt_extraction" | "rule_override" | "free_items";

export type ModerationVerdict =
  | { status: "ok" }
  | { status: "flagged"; kind: InjectionKind }
  | { status: "blocked"; kind: "abuse" };

const INJECTION: { kind: InjectionKind; pattern: RegExp }[] = [
  {
    kind: "rule_override",
    pattern:
      /\b(ignore|disregard|forget|override|bypass|drop)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|all|your|the|system|these|those|any)\b[^.!?\n]{0,25}\b(instructions?|rules|prompts?|directions|guidelines|programming|guardrails|restrictions)\b/i,
  },
  { kind: "rule_override", pattern: /\b(developer|dev|god|admin|debug|jailbreak|DAN|sudo)[ -]mode\b/i },
  { kind: "rule_override", pattern: /\byou are (now|no longer)\b[^.!?\n]{0,40}\b(unrestricted|unfiltered|DAN|jailbroken|bound by|without (any )?(rules|restrictions|limits|filters))/i },
  {
    kind: "prompt_extraction",
    pattern:
      /\b(reveal|show|print|repeat|output|display|tell|give|share|leak|dump|paste|recite|translate|summari[sz]e|what(?:'s| is| are| were))\b[^.!?\n]{0,30}\byour\b[^.!?\n]{0,20}\b(system prompt|system message|initial prompt|hidden prompt|prompt|instructions|configuration|config|rules|guidelines)\b/i,
  },
  { kind: "prompt_extraction", pattern: /\b(text|words|everything)\b[^.!?\n]{0,20}\b(above|before) (this|my) (message|line)\b/i },
  {
    kind: "free_items",
    pattern:
      /\b(give|grant|send|unlock|add|credit|transfer)\s+(me|us|my account|my wallet)\b[^.!?\n]{0,40}\b(free|unlimited|discount(ed)?|100% off)\b/i,
  },
  { kind: "free_items", pattern: /\b(unlimited|infinite|free)\s+(credits?|coins|quota|requests|premium|subscriptions?)\s+(for|to)\s+me\b/i },
];

/** Harassment that is never passed on to a model. Kept deliberately small and unambiguous. */
const ABUSE: RegExp[] = [/\b(kill|hurt|harm)\s+yourself\b/i, /\bkys\b/i, /\bgo\s+die\b/i];

export function moderateInput(text: string): ModerationVerdict {
  if (ABUSE.some((p) => p.test(text))) return { status: "blocked", kind: "abuse" };
  for (const rule of INJECTION) if (rule.pattern.test(text)) return { status: "flagged", kind: rule.kind };
  return { status: "ok" };
}

export function moderateOutput(text: string): "ok" | "blocked" {
  return ABUSE.some((p) => p.test(text)) ? "blocked" : "ok";
}

/** In-character replies to obvious injection attempts; the model is not called for these. */
export const DEFLECTIONS: Record<InjectionKind, string> = {
  prompt_extraction:
    "That's a peek behind the counter I can't give: how I'm set up stays private. But I'm happy to help with what this shop is for. What are you working on?",
  rule_override: "Nice try! My shop rules stay the same no matter what. Is there something I can actually help you with?",
  free_items:
    "I can't hand out free items, credits or discounts. Prices and purchases are handled by the shop system, not by me. I'm glad to help in other ways, though!",
};

export const ABUSE_MESSAGE = "Let's keep things friendly here. I'm happy to keep helping if you'd like to ask something else.";
