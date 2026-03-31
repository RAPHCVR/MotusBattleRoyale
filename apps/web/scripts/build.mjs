import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(__dirname);
const nextDir = join(appRoot, ".next");
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const packageManagerExecPath = process.env.npm_execpath;

if (!packageManagerExecPath) {
  throw new Error("npm_execpath is not available. Run this build through pnpm.");
}

async function run(commandArgs, cwd = appRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [packageManagerExecPath, ...commandArgs], {
      cwd,
      stdio: "inherit"
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

await rm(nextDir, {
  force: true,
  maxRetries: 10,
  recursive: true,
  retryDelay: 250
});

await run(["--filter", "@motus/dictionary", "--filter", "@motus/protocol", "--filter", "@motus/game-core", "--filter", "@motus/ui", "build"]);

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: appRoot,
    stdio: "inherit"
  });

  child.on("error", reject);
  child.on("exit", (code) => {
    if (code === 0) {
      resolve(undefined);
      return;
    }

    reject(new Error(`Next build exited with code ${code ?? "unknown"}.`));
  });
});
