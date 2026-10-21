import { TranscriptApp } from "@/components/transcript-app";
import { LoginForm } from "@/components/login-form";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validSession } from "@/lib/server/session";

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validSession(token, process.env.APP_ACCESS_CODE) ? <TranscriptApp /> : <LoginForm />;
}
