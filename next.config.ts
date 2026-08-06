import type { NextConfig } from "next";
import { buildContentSecurityPolicy } from "./src/lib/security-headers";

const development = process.env.NODE_ENV !== "production";
const enforceHttps =
  process.env.ENFORCE_HTTPS === "true" ||
  process.env.VERCEL === "1" ||
  process.env.RENDER === "true";
const contentSecurityPolicy = buildContentSecurityPolicy(development, enforceHttps);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.1.159"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          ...(enforceHttps ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
