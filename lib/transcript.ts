export const MAX_URL_LENGTH = 2048;
export const MAX_POLLS = 30;
export const POLL_INTERVAL_MS = 2000;
export const WORKFLOW_TIMEOUT_MS = 120_000;

export interface Transcript {
  originalUrl: string;
  videoId: string;
  language: string;
  text: string;
  segments?: TranscriptSegment[];
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export type TranscriptResponse =
  | { status: "completed"; transcript: Transcript }
  | { status: "pending"; ticket: string };

export function parseYouTubeUrl(input: unknown) {
  if (typeof input !== "string" || input.length > MAX_URL_LENGTH || /[\u0000-\u0020\u007f\\]/.test(input.trim())) {
    throw new Error("Informe uma URL válida do YouTube com até 2.048 caracteres.");
  }
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error("Informe a URL completa, começando com https://."); }
  if (url.href.length > MAX_URL_LENGTH) throw new Error("A URL normalizada ultrapassa o limite de 2.048 caracteres.");

  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Use uma URL HTTP ou HTTPS do YouTube, sem credenciais ou porta.");
  }
  let videoId: string | null = null;
  if (url.hostname === "youtu.be") {
    videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
      videoId = url.searchParams.get("v");
    } else {
      videoId = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    }
  }
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Use um link youtube.com/watch, youtu.be ou youtube.com/shorts com ID de vídeo válido.");
  }
  return {
    videoId,
    originalUrl: url.href,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function transcriptText(transcript: Transcript): string {
  if (!transcript.segments?.length) return transcript.text;
  return transcript.segments.map((segment) => `[${formatTimestamp(segment.offset)}] ${segment.text}`).join("\n\n");
}

// Both clipboard and download use this exact format, preserving literal text.
export function toMarkdown(transcript: Transcript): string {
  const text = transcriptText(transcript);
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(runs.reduce((max, run) => Math.max(max, run.length + 1), 3));
  return `# Transcrição do YouTube\n\nLink original: <${transcript.originalUrl}>\n\nIdioma identificado: ${transcript.language}\n\n## Texto completo\n\n${fence}text\n${text}\n${fence}\n`;
}

export function markdownFilename(transcript: Transcript): string {
  return `youtube-${transcript.videoId}-${transcript.language}.md`;
}
