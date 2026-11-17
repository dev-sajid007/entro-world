import { badRequest } from "./errors";

/** Keyset pagination cursor over (created_at, id). Opaque to clients. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [iso, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [string, string];
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("bad cursor");
    return { createdAt, id };
  } catch {
    throw badRequest("Invalid cursor", "invalid_cursor");
  }
}

/** Splits a `limit + 1` result into a page and the next cursor. */
export function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
}
