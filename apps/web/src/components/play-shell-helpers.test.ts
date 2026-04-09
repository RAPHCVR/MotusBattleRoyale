import { describe, expect, it } from "vitest";

import type { BoardSnapshot } from "@motus/protocol";

import {
  buildKeyboardLetterStates,
  composeGuessDraft,
  createEditableGuessPlaceholder,
  extractEditableGuess,
  getBlockedLetters,
  getEditableSlotCount,
  getKnownLetterLimits,
} from "./play-shell-helpers";

const singleHintBoard: BoardSnapshot = {
  roundIndex: 0,
  wordLength: 6,
  rows: [],
  revealedIndexes: [0],
  hintLetters: ["P", "", "", "", "", ""],
  attemptsRemaining: 6,
  clueUsed: false,
  canUseClue: false,
  roundResolved: false,
  roundSolved: false,
  roundScore: 0,
};

const multiHintBoard: BoardSnapshot = {
  ...singleHintBoard,
  revealedIndexes: [0, 2],
  hintLetters: ["P", "", "L", "", "", ""],
};

const feedbackBoard: BoardSnapshot = {
  ...singleHintBoard,
  rows: [
    {
      guess: "PILOTE",
      tiles: ["correct", "present", "absent", "absent", "absent", "absent"],
    },
    {
      guess: "PALAIS",
      tiles: ["correct", "absent", "present", "absent", "present", "absent"],
    },
  ],
};

const duplicateLimitBoard: BoardSnapshot = {
  ...singleHintBoard,
  revealedIndexes: [],
  hintLetters: ["", "", "", "", "", ""],
  rows: [
    {
      guess: "AAABBB",
      tiles: ["correct", "present", "absent", "absent", "absent", "absent"],
    },
  ],
};

const hintedDuplicateBoard: BoardSnapshot = {
  ...singleHintBoard,
  revealedIndexes: [0],
  hintLetters: ["E", "", "", "", "", ""],
  rows: [
    {
      guess: "EBOUEE",
      tiles: ["correct", "absent", "absent", "absent", "present", "absent"],
    },
  ],
};

describe("play-shell helpers", () => {
  it("keeps locked letters out of the editable input", () => {
    expect(extractEditableGuess("ILOTE", singleHintBoard)).toBe("ILOTE");
    expect(extractEditableGuess("PILOTE", singleHintBoard)).toBe("ILOTE");
    expect(composeGuessDraft("ILOTE", singleHintBoard)).toBe("PILOTE");
  });

  it("supports multiple revealed letters without duplicating them", () => {
    expect(extractEditableGuess("PIOTE", multiHintBoard)).toBe("IOTE");
    expect(extractEditableGuess("PILOTE", multiHintBoard)).toBe("IOTE");
    expect(composeGuessDraft("IOTE", multiHintBoard)).toBe("PILOTE");
  });

  it("reports the right number of editable slots", () => {
    expect(getEditableSlotCount(singleHintBoard)).toBe(5);
    expect(getEditableSlotCount(multiHintBoard)).toBe(4);
    expect(createEditableGuessPlaceholder(multiHintBoard)).toBe(
      "4 lettres restantes",
    );
  });

  it("blocks only letters that are fully eliminated", () => {
    const blockedLetters = getBlockedLetters(feedbackBoard);

    expect(blockedLetters.has("L")).toBe(false);
    expect(blockedLetters.has("I")).toBe(false);
    expect(blockedLetters.has("O")).toBe(true);
    expect(extractEditableGuess("IOUNI", singleHintBoard, blockedLetters)).toBe(
      "IUNI",
    );
    expect(composeGuessDraft("IUNI", singleHintBoard, blockedLetters)).toBe(
      "PIUNI",
    );
  });

  it("promotes keyboard states with the right precedence", () => {
    const keyboardStates = buildKeyboardLetterStates(feedbackBoard);

    expect(keyboardStates.get("P")).toBe("correct");
    expect(keyboardStates.get("I")).toBe("present");
    expect(keyboardStates.get("L")).toBe("present");
  });

  it("caps extra copies once a letter has been fully accounted for", () => {
    const blockedLetters = getBlockedLetters(duplicateLimitBoard);
    const letterLimits = getKnownLetterLimits(duplicateLimitBoard);

    expect(letterLimits.get("A")).toBe(2);
    expect(letterLimits.get("B")).toBe(0);
    expect(
      extractEditableGuess(
        "AAA",
        duplicateLimitBoard,
        blockedLetters,
        letterLimits,
      ),
    ).toBe("AA");
    expect(
      composeGuessDraft(
        "AAA",
        duplicateLimitBoard,
        blockedLetters,
        letterLimits,
      ),
    ).toBe("AA");
  });

  it("counts locked letters toward the duplicate cap", () => {
    const blockedLetters = getBlockedLetters(hintedDuplicateBoard);
    const letterLimits = getKnownLetterLimits(hintedDuplicateBoard);

    expect(letterLimits.get("E")).toBe(2);
    expect(
      extractEditableGuess(
        "EEEE",
        hintedDuplicateBoard,
        blockedLetters,
        letterLimits,
      ),
    ).toBe("E");
    expect(
      composeGuessDraft(
        "EEEE",
        hintedDuplicateBoard,
        blockedLetters,
        letterLimits,
      ),
    ).toBe("EE");
  });
});
