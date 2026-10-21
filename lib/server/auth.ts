import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { allowedOrigins } from "../origins.ts";
import { AppError } from "./errors.ts";

export function authorize(request: Request, env: Readonly<Record<string, string | undefined>>): string {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).has(origin)) {
    throw new AppError(403, "INVALID_ORIGIN", "Origem da solicitação não permitida. Abra a aplicação pela URL configurada.");
  }
  const expected = env.APP_ACCESS_CODE;
  if (!expected || expected.length < 16 || expected.length > 256) {
    throw new AppError(503, "APP_CONFIG", "O código de acesso precisa ser configurado pelo responsável pela aplicação.");
  }
  const received = request.headers.get("x-app-access-code") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (received.length > 256 || !timingSafeEqual(digest(received), digest(expected))) {
    throw new AppError(401, "UNAUTHORIZED", "Código de acesso inválido. Confira o código e tente novamente.");
  }
  return expected;
}
