import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_ROUND_LENGTHS, getWordLength, normalizeWord } from "./index.js";
import { CURATED_BANNED_WORDS, CURATED_SOLUTION_WORDS } from "./solutions.js";

export type DictionarySourceRole = "solutions" | "allowed" | "banned";

export type DictionarySourceStat = {
  id: string;
  label: string;
  role: DictionarySourceRole;
  rawEntries: number;
  normalizedEntries: number;
  acceptedEntries: number;
  lengths: Array<{
    length: number;
    accepted: number;
  }>;
};

export type DictionaryStats = {
  solutionCount: number;
  allowedCount: number;
  bannedCount: number;
  lengths: Array<{
    length: number;
    solutions: number;
    allowed: number;
  }>;
  sources: DictionarySourceStat[];
};

type WordBank = {
  solutionWords: string[];
  allowedWords: string[];
  bannedWords: string[];
  solutionWordSet: Set<string>;
  allowedWordSet: Set<string>;
  bannedWordSet: Set<string>;
  solutionsByLength: Map<number, string[]>;
  allowedByLength: Map<number, string[]>;
  allowedSetsByLength: Map<number, Set<string>>;
  stats: DictionaryStats;
};

type WordSource = {
  id: string;
  label: string;
  role: DictionarySourceRole;
  words: Iterable<string>;
};

type ProcessedSources = {
  words: string[];
  wordSet: Set<string>;
  sourceStats: DictionarySourceStat[];
};

const require = createRequire(import.meta.url);
const frenchWordListPath = require("french-wordlist") as string;
const frenchBadWords = require("french-badwords-list/dist/array.js") as string[];
const dataDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const targetLengthSet = new Set<number>(DEFAULT_ROUND_LENGTHS);
const targetLengths = [...targetLengthSet].sort((left, right) => left - right);

function createEmptyBuckets() {
  return new Map<number, string[]>(targetLengths.map((length) => [length, []]));
}

function createWordBuckets(words: readonly string[]) {
  const buckets = createEmptyBuckets();

  for (const word of words) {
    buckets.get(word.length)?.push(word);
  }

  return buckets;
}

function loadFrenchWordList(): string[] {
  const rawDictionary = readFileSync(frenchWordListPath, "utf8");
  return rawDictionary.split(/\r?\n/);
}

function readWordSourceFile(filePath: string): string[] {
  const rawContent = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  return rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function collectWordSourceFiles(role: DictionarySourceRole): WordSource[] {
  const roleDirectory = path.join(dataDirectory, role);

  if (!existsSync(roleDirectory)) {
    return [];
  }

  const files = readdirSync(roleDirectory, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => {
      const entryPath =
        "parentPath" in entry && typeof entry.parentPath === "string"
          ? path.join(entry.parentPath, entry.name)
          : path.join(roleDirectory, entry.name);

      return {
        entryPath,
        relativePath: path.relative(roleDirectory, entryPath),
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "fr"));

  return files.map(({ entryPath, relativePath }) => ({
    id: `file:${role}/${relativePath.replace(/\\/g, "/")}`,
    label: relativePath.replace(/\\/g, "/"),
    role,
    words: readWordSourceFile(entryPath),
  }));
}

function processWordSources(
  sources: readonly WordSource[],
  blockedWords = new Set<string>(),
): ProcessedSources {
  const acceptedWords: string[] = [];
  const acceptedWordSet = new Set<string>();
  const sourceStats: DictionarySourceStat[] = [];

  for (const source of sources) {
    const acceptedCountsByLength = new Map<number, number>(
      targetLengths.map((length) => [length, 0]),
    );
    const sourceSeenWords = new Set<string>();
    let rawEntries = 0;
    let normalizedEntries = 0;
    let acceptedEntries = 0;

    for (const rawWord of source.words) {
      rawEntries += 1;

      const normalized = normalizeWord(rawWord);
      const length = getWordLength(normalized);

      if (
        !normalized ||
        !targetLengthSet.has(length) ||
        blockedWords.has(normalized) ||
        sourceSeenWords.has(normalized)
      ) {
        continue;
      }

      sourceSeenWords.add(normalized);
      normalizedEntries += 1;

      if (acceptedWordSet.has(normalized)) {
        continue;
      }

      acceptedWordSet.add(normalized);
      acceptedWords.push(normalized);
      acceptedEntries += 1;
      acceptedCountsByLength.set(length, (acceptedCountsByLength.get(length) ?? 0) + 1);
    }

    sourceStats.push({
      id: source.id,
      label: source.label,
      role: source.role,
      rawEntries,
      normalizedEntries,
      acceptedEntries,
      lengths: targetLengths.map((length) => ({
        length,
        accepted: acceptedCountsByLength.get(length) ?? 0,
      })),
    });
  }

  acceptedWords.sort((left, right) => left.localeCompare(right, "fr"));

  return {
    words: acceptedWords,
    wordSet: acceptedWordSet,
    sourceStats,
  };
}

function createWordBank(): WordBank {
  const bannedSources: WordSource[] = [
    {
      id: "builtin:curated-banned",
      label: "Curated banned",
      role: "banned",
      words: CURATED_BANNED_WORDS,
    },
    {
      id: "package:french-badwords-list",
      label: "french-badwords-list",
      role: "banned",
      words: frenchBadWords,
    },
    ...collectWordSourceFiles("banned"),
  ];
  const bannedData = processWordSources(bannedSources);
  const solutionSources: WordSource[] = [
    {
      id: "builtin:curated-solutions",
      label: "Curated solutions",
      role: "solutions",
      words: CURATED_SOLUTION_WORDS,
    },
    ...collectWordSourceFiles("solutions"),
  ];
  const solutionData = processWordSources(solutionSources, bannedData.wordSet);
  const allowedSources: WordSource[] = [
    {
      id: "package:french-wordlist",
      label: "french-wordlist",
      role: "allowed",
      words: loadFrenchWordList(),
    },
    {
      id: "builtin:solution-words",
      label: "All solution words",
      role: "allowed",
      words: solutionData.words,
    },
    ...collectWordSourceFiles("allowed"),
  ];
  const allowedData = processWordSources(allowedSources, bannedData.wordSet);
  const bannedWords = bannedData.words;
  const solutionWords = solutionData.words;
  const allowedWords = allowedData.words;
  const solutionsByLength = createWordBuckets(solutionWords);
  const allowedByLength = createWordBuckets(allowedWords);
  const allowedSetsByLength = new Map<number, Set<string>>();

  for (const [length, words] of allowedByLength.entries()) {
    allowedSetsByLength.set(length, new Set(words));
  }

  return {
    solutionWords,
    allowedWords,
    bannedWords,
    solutionWordSet: solutionData.wordSet,
    allowedWordSet: allowedData.wordSet,
    bannedWordSet: bannedData.wordSet,
    solutionsByLength,
    allowedByLength,
    allowedSetsByLength,
    stats: {
      solutionCount: solutionWords.length,
      allowedCount: allowedWords.length,
      bannedCount: bannedWords.length,
      lengths: targetLengths.map((length) => ({
        length,
        solutions: solutionsByLength.get(length)?.length ?? 0,
        allowed: allowedByLength.get(length)?.length ?? 0,
      })),
      sources: [...solutionData.sourceStats, ...allowedData.sourceStats, ...bannedData.sourceStats],
    },
  };
}

const wordBank = createWordBank();

export function getSolutionWords(length?: number): string[] {
  if (!length) {
    return [...wordBank.solutionWords];
  }

  return [...(wordBank.solutionsByLength.get(length) ?? [])];
}

export function getAllowedGuesses(length?: number): string[] {
  if (!length) {
    return [...wordBank.allowedWords];
  }

  return [...(wordBank.allowedByLength.get(length) ?? [])];
}

export function isBannedWord(word: string): boolean {
  return wordBank.bannedWordSet.has(normalizeWord(word));
}

export function isAllowedGuess(word: string, expectedLength?: number): boolean {
  const normalized = normalizeWord(word);

  if (!normalized || (expectedLength && normalized.length !== expectedLength) || isBannedWord(normalized)) {
    return false;
  }

  if (!expectedLength) {
    return wordBank.allowedWordSet.has(normalized);
  }

  return wordBank.allowedSetsByLength.get(expectedLength)?.has(normalized) ?? false;
}

export function getDictionaryStats(): DictionaryStats {
  return {
    solutionCount: wordBank.stats.solutionCount,
    allowedCount: wordBank.stats.allowedCount,
    bannedCount: wordBank.stats.bannedCount,
    lengths: wordBank.stats.lengths.map((lengthStats) => ({ ...lengthStats })),
    sources: wordBank.stats.sources.map((sourceStats) => ({
      ...sourceStats,
      lengths: sourceStats.lengths.map((lengthStats) => ({ ...lengthStats })),
    })),
  };
}

export function createSeededRandom(seed: string): () => number {
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return function next() {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWordSequence(seed: string, roundLengths = DEFAULT_ROUND_LENGTHS): string[] {
  const random = createSeededRandom(seed);
  const usedWords = new Set<string>();

  return roundLengths.map((length, index) => {
    const availableWords = getSolutionWords(length).filter((word) => !usedWords.has(word));
    const pool = availableWords.length > 0 ? availableWords : getSolutionWords(length);
    const choice = pool[Math.floor(random() * pool.length)];

    if (!choice) {
      throw new Error(`No candidate word available for round ${index + 1} and length ${length}.`);
    }

    usedWords.add(choice);
    return choice;
  });
}
