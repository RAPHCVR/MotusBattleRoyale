import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { DEFAULT_ROUND_LENGTHS, getWordLength, normalizeWord } from "./index.js";
import { CURATED_BANNED_WORDS, CURATED_SOLUTION_WORDS } from "./solutions.js";

type DictionaryStats = {
  solutionCount: number;
  allowedCount: number;
  bannedCount: number;
  lengths: Array<{
    length: number;
    solutions: number;
    allowed: number;
  }>;
};

type WordBank = {
  solutionWords: string[];
  allowedWords: string[];
  bannedWords: string[];
  solutionsByLength: Map<number, string[]>;
  allowedByLength: Map<number, string[]>;
  allowedSetsByLength: Map<number, Set<string>>;
  stats: DictionaryStats;
};

const require = createRequire(import.meta.url);
const frenchWordListPath = require("french-wordlist") as string;
const frenchBadWords = require("french-badwords-list/dist/array.js") as string[];
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

function buildUniqueWordList(words: Iterable<string>, blockedWords = new Set<string>()): string[] {
  const uniqueWords = new Set<string>();

  for (const word of words) {
    const normalized = normalizeWord(word);

    if (!normalized || !targetLengthSet.has(getWordLength(normalized)) || blockedWords.has(normalized)) {
      continue;
    }

    uniqueWords.add(normalized);
  }

  return [...uniqueWords].sort((left, right) => left.localeCompare(right, "fr"));
}

function loadFrenchWordList(): string[] {
  const rawDictionary = readFileSync(frenchWordListPath, "utf8");
  return rawDictionary.split(/\r?\n/);
}

function createWordBank(): WordBank {
  const bannedWords = buildUniqueWordList([...CURATED_BANNED_WORDS, ...frenchBadWords]);
  const bannedWordSet = new Set(bannedWords);
  const solutionWords = buildUniqueWordList(CURATED_SOLUTION_WORDS, bannedWordSet);
  const allowedWords = buildUniqueWordList([...loadFrenchWordList(), ...solutionWords], bannedWordSet);
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
        allowed: allowedByLength.get(length)?.length ?? 0
      }))
    }
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
  return wordBank.bannedWords.includes(normalizeWord(word));
}

export function isAllowedGuess(word: string, expectedLength?: number): boolean {
  const normalized = normalizeWord(word);

  if (!normalized || (expectedLength && normalized.length !== expectedLength) || isBannedWord(normalized)) {
    return false;
  }

  if (!expectedLength) {
    return wordBank.allowedWords.includes(normalized);
  }

  return wordBank.allowedSetsByLength.get(expectedLength)?.has(normalized) ?? false;
}

export function getDictionaryStats(): DictionaryStats {
  return {
    solutionCount: wordBank.stats.solutionCount,
    allowedCount: wordBank.stats.allowedCount,
    bannedCount: wordBank.stats.bannedCount,
    lengths: wordBank.stats.lengths.map((lengthStats) => ({ ...lengthStats }))
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
