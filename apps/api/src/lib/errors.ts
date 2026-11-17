import type { ZodType } from "zod";

/** An error with a stable machine-readable code that is safe to show to clients. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request", details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "Sign in to continue", code = "unauthorized") => new AppError(401, code, message);
export const forbidden = (message = "You can't do that", code = "forbidden") => new AppError(403, code, message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string, code = "conflict", details?: unknown) => new AppError(409, code, message, details);
export const tooManyRequests = (message = "Too many requests. Try again later.") => new AppError(429, "rate_limited", message);

/** Validates external input; throws a 400 with per-field messages on failure. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new AppError(400, "validation_error", Object.values(fields)[0] ?? "Invalid request", { fields });
}
