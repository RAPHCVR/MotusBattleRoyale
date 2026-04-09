import { normalizeWord } from "@motus/dictionary";
import type { BoardSnapshot, GuessTileState } from "@motus/protocol";

type LockAwareBoard = Pick<
  BoardSnapshot,
  "wordLength" | "revealedIndexes" | "hintLetters"
>;
type KeyboardAwareBoard = Pick<
  BoardSnapshot,
  "rows" | "revealedIndexes" | "hintLetters"
>;

export type KeyboardLetterState =
  | "unused"
  | "absent"
  | "hint"
  | "present"
  | "correct";

const keyboardStatePriority: Record<KeyboardLetterState, number> = {
  unused: 0,
  absent: 1,
  hint: 2,
  present: 3,
  correct: 4,
};

function promoteKeyboardState(
  keyboardStates: Map<string, KeyboardLetterState>,
  letter: string,
  nextState: KeyboardLetterState,
): void {
  if (!letter) {
    return;
  }

  const currentState = keyboardStates.get(letter) ?? "unused";

  if (keyboardStatePriority[nextState] >= keyboardStatePriority[currentState]) {
    keyboardStates.set(letter, nextState);
  }
}

function mapTileStateToKeyboardState(
  tile: GuessTileState,
): KeyboardLetterState {
  switch (tile) {
    case "correct":
      return "correct";
    case "present":
      return "present";
    case "absent":
      return "absent";
    default:
      return "unused";
  }
}

export function getLockedLetters(
  boardSnapshot?: LockAwareBoard | null,
): string[] {
  if (!boardSnapshot) {
    return [];
  }

  const lockedIndexes = new Set(boardSnapshot.revealedIndexes);

  return Array.from({ length: boardSnapshot.wordLength }, (_, index) =>
    lockedIndexes.has(index) ? (boardSnapshot.hintLetters[index] ?? "") : "",
  );
}

export function getEditableSlotCount(
  boardSnapshot?: LockAwareBoard | null,
): number {
  if (!boardSnapshot) {
    return 0;
  }

  return Math.max(
    0,
    boardSnapshot.wordLength - boardSnapshot.revealedIndexes.length,
  );
}

export function extractEditableGuess(
  rawInput: string,
  boardSnapshot?: LockAwareBoard | null,
  blockedLetters: ReadonlySet<string> = new Set(),
  letterLimits: ReadonlyMap<string, number> = new Map(),
): string {
  if (!boardSnapshot) {
    return "";
  }

  const normalized = normalizeWord(rawInput);
  const lockedLetters = getLockedLetters(boardSnapshot);
  const usageCounts = new Map<string, number>();
  const editableGuess: string[] = [];
  const maxEditableLength = getEditableSlotCount(boardSnapshot);
  let inputIndex = 0;

  for (const lockedLetter of lockedLetters) {
    if (!lockedLetter) {
      continue;
    }

    usageCounts.set(lockedLetter, (usageCounts.get(lockedLetter) ?? 0) + 1);
  }

  for (
    let index = 0;
    index < boardSnapshot.wordLength &&
    editableGuess.length < maxEditableLength;
    index += 1
  ) {
    const lockedLetter = lockedLetters[index];

    if (lockedLetter) {
      if (normalized[inputIndex] === lockedLetter) {
        inputIndex += 1;
      }
      continue;
    }

    const nextLetter = normalized[inputIndex];

    if (!nextLetter) {
      continue;
    }

    if (blockedLetters.has(nextLetter)) {
      inputIndex += 1;
      continue;
    }

    const letterLimit = letterLimits.get(nextLetter);
    if (
      letterLimit !== undefined &&
      (usageCounts.get(nextLetter) ?? 0) >= letterLimit
    ) {
      inputIndex += 1;
      continue;
    }

    editableGuess.push(nextLetter);
    usageCounts.set(nextLetter, (usageCounts.get(nextLetter) ?? 0) + 1);
    inputIndex += 1;
  }

  return editableGuess.join("").slice(0, maxEditableLength);
}

export function composeGuessDraft(
  editableGuess: string,
  boardSnapshot?: LockAwareBoard | null,
  blockedLetters: ReadonlySet<string> = new Set(),
  letterLimits: ReadonlyMap<string, number> = new Map(),
): string {
  if (!boardSnapshot) {
    return "";
  }

  const lockedLetters = getLockedLetters(boardSnapshot);
  const editableLetters = extractEditableGuess(
    editableGuess,
    boardSnapshot,
    blockedLetters,
    letterLimits,
  ).split("");

  return Array.from(
    { length: boardSnapshot.wordLength },
    (_, index) => lockedLetters[index] || editableLetters.shift() || "",
  ).join("");
}

export function createEditableGuessPlaceholder(
  boardSnapshot?: LockAwareBoard | null,
): string {
  const editableSlotCount = getEditableSlotCount(boardSnapshot);

  if (!boardSnapshot) {
    return "Lettres";
  }

  if (editableSlotCount <= 0) {
    return "Mot complété";
  }

  return editableSlotCount === 1
    ? "1 lettre restante"
    : `${editableSlotCount} lettres restantes`;
}

export function buildKeyboardLetterStates(
  boardSnapshot?: KeyboardAwareBoard | null,
): Map<string, KeyboardLetterState> {
  const keyboardStates = new Map<string, KeyboardLetterState>();

  if (!boardSnapshot) {
    return keyboardStates;
  }

  for (const index of boardSnapshot.revealedIndexes) {
    promoteKeyboardState(
      keyboardStates,
      boardSnapshot.hintLetters[index] ?? "",
      "hint",
    );
  }

  for (const row of boardSnapshot.rows) {
    row.tiles.forEach((tile, index) => {
      promoteKeyboardState(
        keyboardStates,
        row.guess[index] ?? "",
        mapTileStateToKeyboardState(tile),
      );
    });
  }

  return keyboardStates;
}

export function getKnownLetterLimits(
  boardSnapshot?: KeyboardAwareBoard | null,
): Map<string, number> {
  const knownLimits = new Map<string, number>();

  if (!boardSnapshot) {
    return knownLimits;
  }

  for (const row of boardSnapshot.rows) {
    const rowUsage = new Map<
      string,
      { confirmed: number; hasAbsent: boolean }
    >();

    row.tiles.forEach((tile, index) => {
      const letter = row.guess[index] ?? "";

      if (!letter) {
        return;
      }

      const nextUsage = rowUsage.get(letter) ?? {
        confirmed: 0,
        hasAbsent: false,
      };

      if (tile === "absent") {
        nextUsage.hasAbsent = true;
      } else if (tile === "correct" || tile === "present") {
        nextUsage.confirmed += 1;
      }

      rowUsage.set(letter, nextUsage);
    });

    for (const [letter, usage] of rowUsage.entries()) {
      if (!usage.hasAbsent) {
        continue;
      }

      const exactLimit = usage.confirmed;
      const currentLimit = knownLimits.get(letter);

      if (currentLimit === undefined || exactLimit < currentLimit) {
        knownLimits.set(letter, exactLimit);
      }
    }
  }

  return knownLimits;
}

export function getBlockedLetters(
  boardSnapshot?: KeyboardAwareBoard | null,
): Set<string> {
  const keyboardStates = buildKeyboardLetterStates(boardSnapshot);
  const blockedLetters = new Set<string>();

  for (const [letter, state] of keyboardStates.entries()) {
    if (state === "absent") {
      blockedLetters.add(letter);
    }
  }

  return blockedLetters;
}
