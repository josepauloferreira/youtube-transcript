import type { NextConfig } from "next";
import { codespacesHost } from "./lib/origins.ts";

const forwardedHost = codespacesHost(process.env);
const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  allowedDevOrigins: forwardedHost ? [forwardedHost] : [],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;
