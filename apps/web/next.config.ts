import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/quiz-core", "@workspace/quiz-ui"],
}

export default nextConfig
