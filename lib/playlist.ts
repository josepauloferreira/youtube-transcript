import { MAX_URL_LENGTH, parseYouTubeUrl } from "./transcript.ts";

export const MAX_PLAYLIST_VIDEOS = 5000;

export interface Playlist {
  playlistId: string;
  originalUrl: string;
  videoIds: string[];
}

export interface PlaylistFailure {
  videoId: string;
  message: string;
}

export function parsePlaylistUrl(input: unknown) {
  const invalid = () => new Error("Use um link do YouTube com uma playlist válida (list=…).");
  if (typeof input !== "string" || input.length > MAX_URL_LENGTH || /[\u0000-\u0020\u007f\\]/.test(input.trim())) throw invalid();
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw invalid(); }
  if (url.href.length > MAX_URL_LENGTH || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) throw invalid();
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    if (url.pathname !== "/playlist") {
      try { parseYouTubeUrl(input); } catch { throw invalid(); }
    }
  } else if (url.hostname === "youtu.be") {
    try { parseYouTubeUrl(input); } catch { throw invalid(); }
  } else throw invalid();
  const playlistId = url.searchParams.get("list");
  if (url.searchParams.getAll("list").length !== 1 || !playlistId || !/^[A-Za-z0-9_-]{10,128}$/.test(playlistId)) throw invalid();
  return { playlistId, originalUrl: url.href, canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}` };
}

export function parseYouTubeSource(input: string) {
  let playlist = false;
  try { const url = new URL(input.trim()); playlist = url.searchParams.has("list") || url.pathname === "/playlist"; } catch { /* Video parser supplies the error. */ }
  return playlist ? { kind: "playlist" as const, ...parsePlaylistUrl(input) } : { kind: "video" as const, ...parseYouTubeUrl(input) };
}
