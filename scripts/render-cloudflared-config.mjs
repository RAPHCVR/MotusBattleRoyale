import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const envFile = join(repoRoot, ".env");
const templatePath = join(repoRoot, "infra", "cloudflared", "config.example.yml");
const outputPath = join(repoRoot, "infra", "cloudflared", "config.yml");

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

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value];
      })
  );
}

const envFromFile = existsSync(envFile) ? parseDotEnv(await readFile(envFile, "utf8")) : {};
const baseDomain = process.env.BASE_DOMAIN ?? envFromFile.BASE_DOMAIN;

if (!baseDomain) {
  throw new Error("Missing BASE_DOMAIN. Set it in .env or the current shell before rendering cloudflared config.");
}

const variables = {
  BASE_DOMAIN: baseDomain,
  CLOUDFLARED_TUNNEL_ID: process.env.CLOUDFLARED_TUNNEL_ID ?? envFromFile.CLOUDFLARED_TUNNEL_ID,
  PUBLIC_ORIGIN_SERVICE:
    process.env.PUBLIC_ORIGIN_SERVICE ??
    envFromFile.PUBLIC_ORIGIN_SERVICE ??
    "http://caddy:80",
  PUBLIC_HOST_HEADER:
    process.env.PUBLIC_HOST_HEADER ??
    envFromFile.PUBLIC_HOST_HEADER ??
    `motus.${baseDomain}`
};

for (const [key, value] of Object.entries(variables)) {
  if (!value) {
    throw new Error(`Missing ${key}. Set it in .env or the current shell before rendering cloudflared config.`);
  }
}

const template = await readFile(templatePath, "utf8");
const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/gu, (_, key) => {
  const value = variables[key];

  if (!value) {
    throw new Error(`Missing value for ${key} while rendering cloudflared config.`);
  }

  return value;
});

await writeFile(outputPath, rendered, "utf8");
console.log(`Rendered ${outputPath}`);
