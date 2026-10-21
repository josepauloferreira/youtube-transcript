import { createSessionApi } from "@/lib/server/session-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return createSessionApi(process.env).login(request);
}

export async function DELETE(request: Request) {
  return createSessionApi(process.env).logout(request);
}
