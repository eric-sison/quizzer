import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/quiz-core", "@workspace/quiz-ui"],

  /**
   * Better Auth runs inside apps/api, but its cookies and Google redirect URI
   * are scoped to THIS origin. The rewrite makes /api/auth/* same-origin for
   * the browser while the API answers it.
   *
   * Read from process.env directly: lib/env.ts is `server-only` and cannot be
   * imported by the config file.
   */
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3000"
    return [
      {
        source: "/api/auth/:path*",
        destination: `${apiOrigin}/api/auth/:path*`,
      },
    ]
  },
}

export default nextConfig
