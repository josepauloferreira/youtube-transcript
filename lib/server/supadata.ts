import "server-only";
import { AppError, externalError } from "./errors.ts";
import { isRecord, readLimitedJson } from "./http.ts";
import type { TranscriptSegment } from "../transcript.ts";

export const UPSTREAM_TIMEOUT_MS = 15_000;
export const MAX_EXTERNAL_BYTES = 2_000_000;
const API_URL = "https://api.supadata.ai/v1/transcript";
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ProviderResult =
  | { status: "completed"; text: string; language: string; segments: TranscriptSegment[] }
  | { status: "pending"; jobId?: string };

export function validJobId(id: unknown): id is string {
  return typeof id === "string" && JOB_ID.test(id);
}

function parseTranscript(data: unknown): ProviderResult {
  if (!isRecord(data)) throw externalError(502);
  let text: string;
  let segments: TranscriptSegment[] = [];
  if (typeof data.content === "string") text = data.content;
  else if (Array.isArray(data.content)) {
    segments = data.content.map((item): TranscriptSegment => {
      if (!isRecord(item) || typeof item.text !== "string" ||
          typeof item.offset !== "number" || !Number.isFinite(item.offset) || item.offset < 0 || item.offset > Number.MAX_SAFE_INTEGER ||
          typeof item.duration !== "number" || !Number.isFinite(item.duration) || item.duration < 0 || item.duration > Number.MAX_SAFE_INTEGER) throw externalError(502);
      return { text: item.text, offset: item.offset, duration: item.duration };
    });
    text = segments.map((item) => item.text).join("\n");
  } else throw externalError(502);
  if (!text.trim()) throw externalError(206);
  if (typeof data.lang !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(data.lang)) throw externalError(502);
  return { status: "completed", text, language: data.lang, segments };
}

export function createSupadata(apiKey: string | undefined, fetcher: typeof fetch) {
  async function call(url: URL, job: boolean): Promise<ProviderResult> {
    if (!apiKey?.trim() || /[\r\n]/.test(apiKey)) {
      throw new AppError(503, "PROVIDER_CONFIG", "A chave da Supadata precisa ser configurada pelo responsável pela aplicação.");
    }
    try {
      const response = await fetcher(url, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      // 206 is a documented error despite Response.ok being true.
      if (![200, 202].includes(response.status)) {
        await response.body?.cancel();
        throw externalError(response.status);
      }
      const data = await readLimitedJson(response, MAX_EXTERNAL_BYTES);
      if (!isRecord(data)) throw externalError(502);
      if (job) {
        if (data.status === "queued" || data.status === "active") return { status: "pending" };
        if (data.status === "failed") {
          const error = isRecord(data.error) ? data.error.error : data.error;
          throw externalError(502, error);
        }
        if (data.status !== "completed") throw externalError(502);
        // Official examples use both flattened responses and a result envelope.
        return parseTranscript(data.result ?? data);
      }
      if (response.status === 202 || "jobId" in data) {
        if (!validJobId(data.jobId)) throw externalError(502);
        return { status: "pending", jobId: data.jobId };
      }
      return parseTranscript(data);
    } catch (error) {
      if (error instanceof AppError && !["TOO_LARGE", "INVALID_JSON"].includes(error.code)) throw error;
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
        throw new AppError(504, "UPSTREAM_TIMEOUT", "O serviço de legendas demorou a responder. Tente novamente mais tarde.");
      }
      throw externalError(502);
    }
  }
  return {
    extract(canonicalUrl: string) {
      const url = new URL(API_URL);
      url.search = new URLSearchParams({ url: canonicalUrl, mode: "native", text: "false" }).toString();
      return call(url, false);
    },
    status(jobId: string) {
      if (!validJobId(jobId)) throw externalError(502);
      return call(new URL(`${API_URL}/${jobId}`), true);
    },
  };
}
