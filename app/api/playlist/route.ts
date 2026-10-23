import { createApi } from "@/lib/server/api";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return createApi({ env: process.env, fetcher: fetch }).playlist(request);
}
