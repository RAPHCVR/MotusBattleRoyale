export const DEFAULT_ROUND_LENGTHS = [6, 6, 6, 6, 6, 7, 7] as const;

export function normalizeWord(input: string): string {
  return input
    .replace(/[Ææ]/g, "AE")
    .replace(/[Œœ]/g, "OE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

export function getWordLength(word: string): number {
  return normalizeWord(word).length;
}
