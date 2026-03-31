import { spawn } from "node:child_process";

const packageManagerExecPath = process.env.npm_execpath;

if (!packageManagerExecPath) {
  throw new Error("npm_execpath is not available. Run this script through pnpm or npm.");
}

function run(commandArgs) {
  const child = spawn(process.execPath, [packageManagerExecPath, ...commandArgs], {
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });

  return child;
}

const children = [
  run(["--filter", "@motus/game", "dev"]),
  run(["--filter", "@motus/web", "dev"])
];

function shutdown() {
  for (const child of children) {
    child.kill("SIGINT");
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
