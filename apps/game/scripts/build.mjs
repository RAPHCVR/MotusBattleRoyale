import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(__dirname);
const packageManagerExecPath = process.env.npm_execpath;

if (!packageManagerExecPath) {
  throw new Error("npm_execpath is not available. Run this build through pnpm.");
}

async function run(commandArgs, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [packageManagerExecPath, ...commandArgs], {
      cwd: appRoot,
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? "unknown"}: ${commandArgs.join(" ")}`));
    });
  });
}

await rm(join(appRoot, "dist"), {
  force: true,
  maxRetries: 10,
  recursive: true,
  retryDelay: 250
});

await run(["--filter", "@motus/dictionary", "--filter", "@motus/protocol", "--filter", "@motus/game-core", "build"]);
await run(["exec", "tsc", "-p", "tsconfig.json"]);
