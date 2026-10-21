import "server-only";
import { AppError } from "./errors.ts";

// Also limits chunked responses and decompressed bodies; Content-Length alone is insufficient.
export async function readLimitedJson(message: Request | Response, limit: number): Promise<unknown> {
  const length = message.headers.get("content-length");
  if (length && Number(length) > limit) throw new AppError(413, "TOO_LARGE", "O conteúdo ultrapassa o tamanho permitido.");
  if (!message.body) throw new AppError(400, "INVALID_JSON", "O conteúdo da solicitação está vazio.");
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppError(413, "TOO_LARGE", "O conteúdo ultrapassa o tamanho permitido.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
