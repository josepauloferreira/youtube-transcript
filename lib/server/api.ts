import "server-only";
import { MAX_POLLS, parseYouTubeUrl, WORKFLOW_TIMEOUT_MS, type TranscriptResponse } from "../transcript.ts";
import { authorize } from "./auth.ts";
import { AppError } from "./errors.ts";
import { isRecord, readLimitedJson } from "./http.ts";
import { createSupadata } from "./supadata.ts";
import { readTicket, signTicket } from "./tickets.ts";

interface Dependencies {
  env: Readonly<Record<string, string | undefined>>;
  fetcher: typeof fetch;
  now?: () => number;
}

function json(body: TranscriptResponse | { error: { code: string; message: string } }, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}

export function createApi({ env, fetcher, now = Date.now }: Dependencies) {
  const provider = createSupadata(env.SUPADATA_API_KEY, fetcher);

  function handler(action: (body: Record<string, unknown>, secret: string) => Promise<TranscriptResponse>) {
    return async (request: Request): Promise<Response> => {
      try {
        const secret = authorize(request, env);
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
          throw new AppError(415, "CONTENT_TYPE", "Envie a solicitação como JSON.");
        }
        let body: unknown;
        try { body = await readLimitedJson(request, 8192); }
        catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, "INVALID_JSON", "O conteúdo da solicitação é inválido.");
        }
        if (!isRecord(body)) throw new AppError(400, "INVALID_INPUT", "O conteúdo da solicitação é inválido.");
        return json(await action(body, secret));
      } catch (error) {
        const safe = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "Não foi possível concluir a solicitação. Tente novamente.");
        // Never log request headers, provider bodies or exception messages.
        return json({ error: { code: safe.code, message: safe.message } }, safe.status);
      }
    };
  }

  return {
    extract: handler(async (body, secret) => {
      let video: ReturnType<typeof parseYouTubeUrl>;
      try { video = parseYouTubeUrl(body.url); }
      catch (error) { throw new AppError(400, "INVALID_URL", (error as Error).message); }
      const expiresAt = now() + WORKFLOW_TIMEOUT_MS;
      const result = await provider.extract(video.canonicalUrl);
      if (result.status === "completed") {
        return { status: "completed", transcript: { originalUrl: video.originalUrl, videoId: video.videoId, language: result.language, text: result.text } };
      }
      if (!result.jobId) throw new AppError(502, "UPSTREAM_ERROR", "O serviço retornou uma consulta inválida.");
      return { status: "pending", ticket: signTicket({ jobId: result.jobId, originalUrl: video.originalUrl, expiresAt, attempt: 0 }, secret) };
    }),
    status: handler(async (body, secret) => {
      const ticket = readTicket(body.ticket, secret, now());
      const result = await provider.status(ticket.jobId);
      if (now() >= ticket.expiresAt) throw new AppError(408, "POLL_LIMIT", "O tempo de consulta terminou. Tente novamente mais tarde.");
      if (result.status === "completed") {
        const video = parseYouTubeUrl(ticket.originalUrl);
        return { status: "completed", transcript: { originalUrl: video.originalUrl, videoId: video.videoId, language: result.language, text: result.text } };
      }
      if (ticket.attempt + 1 >= MAX_POLLS) throw new AppError(408, "POLL_LIMIT", "O limite de consultas foi atingido. Tente novamente mais tarde.");
      return { status: "pending", ticket: signTicket({ ...ticket, attempt: ticket.attempt + 1 }, secret) };
    }),
  };
}
