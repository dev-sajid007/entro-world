import type { FastifyError, FastifyInstance } from "fastify";
import type { ApiErrorBody } from "@entroworld/shared";
import { AppError } from "../lib/errors";

const body = (code: string, message: string, details?: unknown): ApiErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

/** Every error leaves the API as `{ error: { code, message, details? } }`; internals are never leaked. */
export function setupErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    }
    const status = error.statusCode ?? 500;
    if (status === 429) return reply.status(429).send(body("rate_limited", "Too many requests. Try again later."));
    if (status === 413) return reply.status(413).send(body("payload_too_large", "Request body is too large"));
    if (status === 415) return reply.status(415).send(body("unsupported_media_type", "Unsupported content type"));
    if (status >= 400 && status < 500) {
      const code = error.code === "FST_ERR_CTP_INVALID_JSON_BODY" || error instanceof SyntaxError ? "invalid_json" : "bad_request";
      return reply.status(status).send(body(code, status === 400 ? "Malformed request" : error.message));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send(body("internal_error", "Something went wrong on our side"));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body("not_found", `No route for ${request.method} ${request.url.split("?")[0]}`));
  });
}
