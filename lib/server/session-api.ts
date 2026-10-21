import "server-only";
import { accessSecret, assertOrigin, correctPassword, type Environment } from "./auth.ts";
import { AppError } from "./errors.ts";
import { isRecord, readLimitedJson } from "./http.ts";
import { createSession, SESSION_COOKIE, SESSION_SECONDS } from "./session.ts";
import { codespacesHost } from "../origins.ts";

export function createSessionApi(env: Environment, now = Date.now) {
  function cookie(request: Request, value: string, maxAge: number): string {
    const secure = env.NODE_ENV === "production" || Boolean(codespacesHost(env)) || request.headers.get("origin")?.startsWith("https://");
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  function handler(action: (request: Request) => Promise<Response>) {
    return async (request: Request): Promise<Response> => {
      try {
        assertOrigin(request, env);
        return await action(request);
      } catch (error) {
        const safe = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "Não foi possível entrar. Tente novamente.");
        return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
      }
    };
  }

  return {
    login: handler(async (request) => {
      const secret = accessSecret(env);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
        throw new AppError(415, "CONTENT_TYPE", "Envie a solicitação como JSON.");
      }
      let body: unknown;
      try { body = await readLimitedJson(request, 2048); }
      catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(400, "INVALID_JSON", "O conteúdo da solicitação é inválido.");
      }
      if (!isRecord(body) || !correctPassword(body.password, secret)) {
        throw new AppError(401, "INVALID_PASSWORD", "Senha incorreta. Confira e tente novamente.");
      }
      return Response.json({ ok: true }, { headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookie(request, createSession(secret, now()), SESSION_SECONDS),
      } });
    }),
    logout: handler(async (request) => new Response(null, { status: 204, headers: {
      "Cache-Control": "no-store", "Set-Cookie": cookie(request, "", 0),
    } })),
  };
}
