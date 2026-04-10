import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(configDir, "../../"),
  allowedDevOrigins: ["127.0.0.1", "play-dev.raphcvr.me", "rt-dev.raphcvr.me"]
};

export default nextConfig;
