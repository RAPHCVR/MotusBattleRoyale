import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const envFile = join(repoRoot, ".env");

function parseDotEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          return [line, ""];
        }

        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      })
  );
}

const envFromFile = existsSync(envFile) ? parseDotEnv(await readFile(envFile, "utf8")) : {};

const baseDomain = process.env.BASE_DOMAIN ?? envFromFile.BASE_DOMAIN;
const tunnelRef =
  process.env.CLOUDFLARED_TUNNEL_NAME ??
  envFromFile.CLOUDFLARED_TUNNEL_NAME ??
  process.env.CLOUDFLARED_TUNNEL_ID ??
  envFromFile.CLOUDFLARED_TUNNEL_ID;
const overwrite = ["1", "true", "yes"].includes(
  (process.env.CLOUDFLARED_OVERWRITE_DNS ?? envFromFile.CLOUDFLARED_OVERWRITE_DNS ?? "").toLowerCase()
);

if (!baseDomain) {
  throw new Error("Missing BASE_DOMAIN. Set it in .env or in the shell before provisioning DNS routes.");
}

if (!tunnelRef) {
  throw new Error(
    "Missing CLOUDFLARED_TUNNEL_NAME or CLOUDFLARED_TUNNEL_ID. Set one of them in .env or in the shell."
  );
}

const hostnames = [`motus.${baseDomain}`];

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("cloudflared", args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`cloudflared failed with exit code ${code ?? "unknown"}: ${args.join(" ")}`));
    });
  });
}

for (const hostname of hostnames) {
  const args = ["tunnel", "route", "dns"];

  if (overwrite) {
    args.push("--overwrite-dns");
  }

  args.push(tunnelRef, hostname);
  await run(args);
}

console.log(`Provisioned DNS hostnames for tunnel '${tunnelRef}': ${hostnames.join(", ")}`);
