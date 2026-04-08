import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "play-dev.raphcvr.me", "rt-dev.raphcvr.me"]
};

export default nextConfig;
