import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultInputPath = path.join(repoRoot, ".tmp", "lexique", "Lexique383", "Lexique383.tsv");
const outputPath = path.join(
  repoRoot,
  "packages",
  "dictionary",
  "data",
  "solutions",
  "lexique-common-top1400.txt",
);

const targetCountsByLength = new Map([
  [6, 1000],
  [7, 400],
]);

const require = createRequire(new URL("../packages/dictionary/package.json", import.meta.url));
const frenchBadWords = require("french-badwords-list/dist/array.js");

function normalizeWord(input) {
  return input
    .replace(/[Ææ]/g, "AE")
    .replace(/[Œœ]/g, "OE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function formatScore(value) {
  return value.toFixed(2);
}

const bannedWords = new Set(["INSULTE", "HAINEUX", ...frenchBadWords.map(normalizeWord)]);
const manualSolutionExclusions = new Set([
  "APPART",
  "BAISER",
  "BAISERS",
  "BOCHES",
  "BOUFFE",
  "CAPOTE",
  "CHATTE",
  "FESSES",
  "GUEULE",
  "NEGRES",
  "SPERME",
  "VIOLER",
]);

const tsvPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultInputPath;
const rawTsv = await readFile(tsvPath, "utf8");
const lines = rawTsv.split(/\r?\n/);
const headers = lines[0].split("\t");
const indexByHeader = Object.fromEntries(headers.map((header, index) => [header, index]));
const bestCandidatesByLength = new Map(
  [...targetCountsByLength.keys()].map((length) => [length, new Map()]),
);

for (const line of lines.slice(1)) {
  if (!line) {
    continue;
  }

  const columns = line.split("\t");
  const ortho = columns[indexByHeader.ortho] ?? "";
  const cgram = columns[indexByHeader.cgram] ?? "";
  const infover = columns[indexByHeader.infover] ?? "";
  const normalized = normalizeWord(ortho);
  const length = normalized.length;

  if (!bestCandidatesByLength.has(length)) {
    continue;
  }

  if (!/^[A-Za-zÀ-ÿŒœÆæ]+$/.test(ortho) || ortho !== ortho.toLowerCase()) {
    continue;
  }

  if (bannedWords.has(normalized)) {
    continue;
  }

  if (manualSolutionExclusions.has(normalized)) {
    continue;
  }

  const isAllowedGrammar =
    cgram === "NOM" || cgram === "ADJ" || (cgram === "VER" && infover.includes("inf"));

  if (!isAllowedGrammar) {
    continue;
  }

  const score =
    Number(columns[indexByHeader.freqfilms2] || 0) +
    Number(columns[indexByHeader.freqlivres] || 0);

  if (score < 3) {
    continue;
  }

  const bucket = bestCandidatesByLength.get(length);
  const existing = bucket.get(normalized);
  const candidate = {
    normalized,
    ortho,
    cgram,
    score,
  };

  if (!existing || candidate.score > existing.score) {
    bucket.set(normalized, candidate);
  }
}

const selectedByLength = [];
const reportLines = [];

for (const [length, count] of targetCountsByLength.entries()) {
  const ranked = [...bestCandidatesByLength.get(length).values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, count);
  const alphabetical = [...ranked].sort((left, right) =>
    left.normalized.localeCompare(right.normalized, "fr"),
  );

  selectedByLength.push(...alphabetical.map((entry) => entry.normalized));

  const lowest = ranked[ranked.length - 1];
  reportLines.push(
    `# ${length} letters: ${ranked.length} words retained, lowest score=${formatScore(lowest.score)} (${lowest.normalized})`,
  );
}

const outputLines = [
  "# Generated from Lexique 3.83 (lexique.org / openlexicon, CC BY-SA 4.0).",
  "# Source ranking: freqfilms2 + freqlivres.",
  "# Filters: lowercase single-token entries, 6/7 letters after normalization, grammar in NOM/ADJ/VER(inf), profanity/banlist removed.",
  ...reportLines,
  ...selectedByLength,
];

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${outputLines.join("\n")}\n`, "utf8");

console.log(`Generated ${selectedByLength.length} solution words into ${path.relative(repoRoot, outputPath)}.`);
