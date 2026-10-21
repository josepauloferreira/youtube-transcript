import { MAX_POLLS, POLL_INTERVAL_MS, WORKFLOW_TIMEOUT_MS, type TranscriptResponse, type Transcript } from "./transcript.ts";

interface Options {
  signal: AbortSignal;
  onPending: () => void;
  fetcher?: typeof fetch;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class SessionExpiredError extends Error {}

export async function extractTranscript(url: string, options: Options): Promise<Transcript> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(WORKFLOW_TIMEOUT_MS)]);
  const fetcher = options.fetcher ?? fetch;
  async function post(path: string, body: object): Promise<TranscriptResponse> {
    const response = await fetcher(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("O servidor retornou uma resposta inválida. Tente novamente."); }
    if (response.status === 401) throw new SessionExpiredError("Sua sessão expirou. Entre novamente.");
    if (!response.ok) throw new Error(data.error?.message ?? "Não foi possível extrair as legendas.");
    if (data.status !== "completed" && (data.status !== "pending" || typeof data.ticket !== "string")) {
      throw new Error("O servidor retornou uma resposta inválida. Tente novamente.");
    }
    return data as TranscriptResponse;
  }
  let result = await post("/api/transcript", { url });
  for (let count = 0; result.status === "pending" && count < MAX_POLLS; count++) {
    options.onPending();
    await (options.pause ?? pause)(POLL_INTERVAL_MS, signal);
    signal.throwIfAborted();
    result = await post("/api/transcript/status", { ticket: result.ticket });
  }
  if (result.status !== "completed") throw new Error("O limite de consultas foi atingido. Tente novamente mais tarde.");
  return result.transcript;
}
