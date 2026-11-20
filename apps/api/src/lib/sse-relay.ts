import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors";

const aiUnavailable = () => new AppError(503, "ai_unavailable", "The AI helpers are unavailable right now. Please try again soon.");

export interface UpstreamError {
  status: number;
  code: string | undefined;
  message: string | undefined;
}

/**
 * Relays a Server-Sent Events answer from the AI agent service to the client. Errors before
 * streaming starts become normal JSON errors (`mapError` may turn one into a specific error); the
 * client leaving aborts the upstream request, which stops the model.
 */
export async function relayAiStream(
  request: FastifyRequest,
  reply: FastifyReply,
  start: (signal: AbortSignal) => Promise<Response>,
  mapError: (error: UpstreamError) => AppError | null = () => null,
  unavailable: () => AppError = aiUnavailable,
): Promise<FastifyReply> {
  const controller = new AbortController();
  let upstream: Response;
  try {
    upstream = await start(controller.signal);
  } catch (err) {
    request.log.warn({ err }, "AI agent service unreachable");
    throw unavailable();
  }
  if (!upstream.headers.get("content-type")?.startsWith("text/event-stream") || !upstream.body) {
    const data = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const mapped = mapError({ status: upstream.status, code: data?.error?.code, message: data?.error?.message });
    if (mapped) throw mapped;
    request.log.error({ status: upstream.status, code: data?.error?.code }, "AI agent service rejected a request");
    throw unavailable();
  }
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return reply
    .header("content-type", "text/event-stream; charset=utf-8")
    .header("x-accel-buffering", "no")
    .send(Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>));
}
