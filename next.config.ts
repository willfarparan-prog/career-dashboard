import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local sandbox database for `next dev` only (scripts/local-db.ts); never bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@react-pdf/renderer"],
  experimental: {
    // Resume uploads (PDF/DOCX) go through a server action.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
