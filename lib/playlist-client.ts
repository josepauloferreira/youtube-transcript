import { zip, type Zippable } from "fflate";
import { ApiError, extractTranscript, pause, postJson, SessionExpiredError } from "./client.ts";
import { MAX_PLAYLIST_VIDEOS, parsePlaylistUrl, type Playlist, type PlaylistFailure } from "./playlist.ts";
import { markdownFilename, toMarkdown } from "./transcript.ts";

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export interface PlaylistProgress {
  phase: "listing" | "extracting" | "packing";
  total: number;
  processed: number;
  succeeded: number;
}

export interface PlaylistResult {
  playlist: Playlist;
  archive: Uint8Array<ArrayBuffer>;
  succeeded: number;
  failures: PlaylistFailure[];
  stopReason?: string;
}

interface Options {
  signal: AbortSignal;
  onProgress: (progress: PlaylistProgress) => void;
  fetcher?: typeof fetch;
  pause?: typeof pause;
}

function archive(files: Zippable): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data));
  });
}

function report(playlist: Playlist, succeeded: number, failures: PlaylistFailure[], stopReason?: string) {
  return `# Transcrições da playlist\n\nLink original: <${playlist.originalUrl}>\n\nArquivos Markdown: ${succeeded} de ${playlist.videoIds.length} vídeos encontrados.\n\n${stopReason ? `Coleta interrompida: ${stopReason}\n\n` : ""}Cada arquivo usa o mesmo formato da extração individual, com idioma e tempos disponíveis.\n\n${failures.length ? `## Vídeos sem arquivo\n\n${failures.map((failure) => `- <https://www.youtube.com/watch?v=${failure.videoId}> — ${failure.message}`).join("\n")}\n` : "Todos os vídeos encontrados foram coletados.\n"}`;
}

export async function extractPlaylist(url: string, options: Options): Promise<PlaylistResult> {
  parsePlaylistUrl(url);
  const { signal, onProgress, fetcher } = options;
  onProgress({ phase: "listing", total: 0, processed: 0, succeeded: 0 });
  const data = await postJson("/api/playlist", { url }, signal, fetcher) as Playlist;
  if (!data || typeof data.playlistId !== "string" || typeof data.originalUrl !== "string" ||
      !Array.isArray(data.videoIds) || !data.videoIds.length || data.videoIds.length >= MAX_PLAYLIST_VIDEOS ||
      data.videoIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id))) {
    throw new Error("O servidor retornou uma playlist inválida. Tente novamente.");
  }
  const playlist = { ...data, videoIds: [...new Set(data.videoIds)] };
  const files: Zippable = {};
  const failures: PlaylistFailure[] = [];
  let succeeded = 0;
  let processed = 0;
  let bytes = 0;
  let stopReason: string | undefined;
  const progress = (phase: PlaylistProgress["phase"]) => onProgress({ phase, total: playlist.videoIds.length, processed, succeeded });
  progress("extracting");

  for (const videoId of playlist.videoIds) {
    try {
      signal.throwIfAborted();
      // Space the first extraction after listing as well as subsequent calls.
      await (options.pause ?? pause)(1000, signal);
      const transcript = await extractTranscript(`https://www.youtube.com/watch?v=${videoId}`, {
        signal, fetcher, pause: options.pause, onPending: () => {},
      });
      const content = new TextEncoder().encode(`\uFEFF${toMarkdown(transcript)}`);
      if (bytes + content.byteLength > MAX_ARCHIVE_BYTES) {
        stopReason = "Os arquivos atingiram o limite de 100 MiB por coleta. Divida a playlist para continuar.";
        break;
      }
      files[markdownFilename(transcript)] = content;
      bytes += content.byteLength;
      succeeded++;
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (signal.aborted) { stopReason = "Coleta cancelada."; break; }
      if (error instanceof TypeError) { stopReason = "A conexão com o servidor foi interrompida."; break; }
      if (error instanceof ApiError && [402, 429, 503].includes(error.status)) {
        stopReason = error.message;
        break;
      }
      failures.push({ videoId, message: error instanceof Error ? error.message : "Não foi possível coletar as legendas." });
    }
    processed++;
    progress("extracting");
  }

  for (const videoId of playlist.videoIds.slice(processed)) {
    failures.push({ videoId, message: `Não coletado. ${stopReason ?? "A coleta foi interrompida."}` });
  }
  files["LEIA-ME.md"] = new TextEncoder().encode(`\uFEFF${report(playlist, succeeded, failures, stopReason)}`);
  progress("packing");
  return { playlist, succeeded, failures, stopReason, archive: await archive(files) };
}
