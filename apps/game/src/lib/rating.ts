export const DEFAULT_MMR = 1_200;

const ELO_SCALE = 400;
const BASE_K = 28;
const MAX_FIELD_MULTIPLIER = 1.6;
const FIELD_MULTIPLIER_STEP = 0.1;

export interface RatedPlacement {
  userId: string;
  placement: number;
  mmrBefore: number;
}

function computeExpectedScore(playerRating: number, opponentRating: number) {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / ELO_SCALE));
}

function computeFieldMultiplier(fieldSize: number) {
  return Math.min(
    MAX_FIELD_MULTIPLIER,
    1 + Math.max(0, fieldSize - 2) * FIELD_MULTIPLIER_STEP,
  );
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function computeLobbyAnchorMmr(
  mmrs: readonly number[],
  fallback = DEFAULT_MMR,
) {
  if (mmrs.length === 0) {
    return fallback;
  }

  const sorted = [...mmrs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? fallback;
  }

  const left = sorted[middle - 1] ?? fallback;
  const right = sorted[middle] ?? fallback;

  return Math.round((left + right) / 2);
}

export function computeMatchMmrDeltas(players: readonly RatedPlacement[]) {
  if (players.length <= 1) {
    return new Map(players.map((player) => [player.userId, 0]));
  }

  const orderedPlayers = [...players].sort((left, right) => {
    if (left.placement !== right.placement) {
      return left.placement - right.placement;
    }

    return left.userId.localeCompare(right.userId, "fr");
  });
  const fieldMultiplier = computeFieldMultiplier(orderedPlayers.length);
  const rawDeltas = orderedPlayers.map((player, playerIndex) => {
    let actualScore = 0;
    let expectedScore = 0;

    for (let opponentIndex = 0; opponentIndex < orderedPlayers.length; opponentIndex += 1) {
      if (opponentIndex === playerIndex) {
        continue;
      }

      const opponent = orderedPlayers[opponentIndex]!;

      if (player.placement < opponent.placement) {
        actualScore += 1;
      } else if (player.placement === opponent.placement) {
        actualScore += 0.5;
      }

      expectedScore += computeExpectedScore(player.mmrBefore, opponent.mmrBefore);
    }

    const averageScoreDelta =
      (actualScore - expectedScore) / (orderedPlayers.length - 1);

    return BASE_K * fieldMultiplier * averageScoreDelta;
  });

  const roundedDeltas = rawDeltas.map((value) => Math.round(value));
  let drift = sum(roundedDeltas);

  if (drift !== 0) {
    const candidates = orderedPlayers.map((player, index) => ({
      index,
      placement: player.placement,
      roundingError: roundedDeltas[index]! - rawDeltas[index]!,
    }));

    candidates.sort((left, right) => {
      if (drift > 0) {
        if (right.roundingError !== left.roundingError) {
          return right.roundingError - left.roundingError;
        }
      } else if (left.roundingError !== right.roundingError) {
        return left.roundingError - right.roundingError;
      }

      return right.placement - left.placement;
    });

    let candidateIndex = 0;
    while (drift !== 0 && candidates.length > 0) {
      const candidate = candidates[candidateIndex % candidates.length]!;
      roundedDeltas[candidate.index] += drift > 0 ? -1 : 1;
      drift += drift > 0 ? -1 : 1;
      candidateIndex += 1;
    }
  }

  return new Map(
    orderedPlayers.map((player, index) => [player.userId, roundedDeltas[index] ?? 0]),
  );
}
