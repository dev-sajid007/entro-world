import type { ChatBroadcast, ChatChannel } from "@entroworld/game-protocol";
import { LIMITS, type ZoneId } from "@entroworld/shared";

export const chatTopics = {
  zone: (zoneId: ZoneId) => `ew:chat:zone:${zoneId}`,
  global: "ew:chat:global",
} as const;

// Control characters, bidi overrides and zero-width characters are stripped from chat text.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** Normalizes chat text; returns "" when nothing printable remains. */
export function sanitizeChatText(text: string): string {
  return text.replace(UNSAFE, "").replace(/\s+/g, " ").trim().slice(0, LIMITS.chatMessage.max);
}

/** Normalizes multi-line text (code on a class screen): keeps line breaks, drops unsafe characters. */
export function sanitizeMultiline(text: string, max: number): string {
  return text.replace(/\r\n?/g, "\n").replace(UNSAFE, "").replace(/\t/g, "  ").slice(0, max);
}

/** Recent chat kept per room so players joining (or switching zones) see the conversation. */
export class ChatHistory {
  private entries: ChatBroadcast[] = [];

  constructor(private readonly capacity = 40) {}

  push(message: ChatBroadcast): void {
    if (this.entries.some((m) => m.id === message.id)) return;
    this.entries.push(message);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  list(channels?: readonly ChatChannel[]): ChatBroadcast[] {
    return channels ? this.entries.filter((m) => channels.includes(m.channel)) : [...this.entries];
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Validates a chat broadcast received over presence pub/sub (from another room or process). */
export function isChatBroadcast(v: unknown): v is ChatBroadcast {
  if (!isRecord(v) || !isRecord(v.from)) return false;
  return (
    typeof v.id === "string" &&
    (v.channel === "room" || v.channel === "zone" || v.channel === "global") &&
    typeof v.text === "string" &&
    typeof v.zoneId === "string" &&
    typeof v.ts === "number" &&
    typeof v.from.userId === "string" &&
    typeof v.from.username === "string" &&
    typeof v.from.displayName === "string" &&
    typeof v.from.sessionId === "string"
  );
}
