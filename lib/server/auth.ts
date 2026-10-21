import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { allowedOrigins } from "../origins.ts";
import { AppError } from "./errors.ts";
import { sessionFromCookie, validSession } from "./session.ts";

export type Environment = Readonly<Record<string, string | undefined>>;

export function assertOrigin(request: Request, env: Environment): void {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).has(origin)) {
    throw new AppError(403, "INVALID_ORIGIN", "Origem da solicitação não permitida. Abra a aplicação pela URL configurada.");
  }
}

export function accessSecret(env: Environment): string {
  const secret = env.APP_ACCESS_CODE;
  if (!secret || secret.length < 16 || secret.length > 256) {
    throw new AppError(503, "APP_CONFIG", "A senha de acesso precisa ser configurada pelo responsável pela aplicação.");
  }
  return secret;
}

export function correctPassword(received: unknown, expected: string): boolean {
  if (typeof received !== "string" || received.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

export function authorize(request: Request, env: Environment, now = Date.now()): string {
  assertOrigin(request, env);
  const secret = accessSecret(env);
  if (!validSession(sessionFromCookie(request.headers.get("cookie")), secret, now)) {
    throw new AppError(401, "SESSION_REQUIRED", "Sua sessão expirou. Entre novamente para continuar.");
  }
  return secret;
}
