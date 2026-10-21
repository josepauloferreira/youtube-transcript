import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "yt-session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`youtube-personal-session:${payload}`).digest("base64url");
}

export function createSession(secret: string, now = Date.now()): string {
  const payload = `${now + SESSION_SECONDS * 1000}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function validSession(token: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || secret.length < 16 || secret.length > 256 || !token || token.length > 128) return false;
  const match = /^(\d{1,13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt <= now || expiresAt > now + SESSION_SECONDS * 1000) return false;
  const expected = signature(`${match[1]}.${match[2]}`, secret);
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected));
}

export function sessionFromCookie(header: string | null): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}
