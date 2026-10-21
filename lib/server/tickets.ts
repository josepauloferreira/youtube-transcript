import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_POLLS, parseYouTubeUrl, WORKFLOW_TIMEOUT_MS } from "../transcript.ts";
import { AppError } from "./errors.ts";
import { isRecord } from "./http.ts";
import { validJobId } from "./supadata.ts";

export interface Ticket {
  jobId: string;
  originalUrl: string;
  expiresAt: number;
  attempt: number;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`youtube-native-job:${payload}`).digest("base64url");
}

export function signTicket(ticket: Ticket, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function readTicket(value: unknown, secret: string, now: number): Ticket {
  const invalid = () => new AppError(400, "INVALID_TICKET", "A consulta de status é inválida. Inicie uma nova extração.");
  if (typeof value !== "string" || value.length > 6000) throw invalid();
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) throw invalid();
  const expected = signature(payload, secret);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw invalid();
  let data: unknown;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw invalid(); }
  if (!isRecord(data) || !validJobId(data.jobId) || typeof data.originalUrl !== "string" ||
      typeof data.expiresAt !== "number" || !Number.isSafeInteger(data.expiresAt) ||
      typeof data.attempt !== "number" || !Number.isInteger(data.attempt) || data.attempt < 0) throw invalid();
  try { parseYouTubeUrl(data.originalUrl); } catch { throw invalid(); }
  if (data.expiresAt <= now || data.expiresAt > now + WORKFLOW_TIMEOUT_MS || data.attempt >= MAX_POLLS) {
    throw new AppError(408, "POLL_LIMIT", "O tempo de consulta terminou. Aguarde um pouco antes de iniciar uma nova extração.");
  }
  return { jobId: data.jobId, originalUrl: data.originalUrl, expiresAt: data.expiresAt, attempt: data.attempt };
}
