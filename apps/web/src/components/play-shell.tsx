"use client";

import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { Client, type Room } from "colyseus.js";

import { FeedbackToneIcon, GlassPanel, MetricBadge, SectionHeader, WordTile, type WordTileTone } from "@motus/ui";
import type { BoardSnapshot, GuessResult, MatchSummary, RoomSnapshot, SeatReservation, TicketBundle } from "@motus/protocol";

import { authClient } from "@/lib/auth-client";
import {
  buildKeyboardLetterStates,
  composeGuessDraft,
  createEditableGuessPlaceholder,
  extractEditableGuess,
  type KeyboardLetterState,
  getEditableSlotCount,
  getBlockedLetters,
  getLockedLetters
} from "@/components/play-shell-helpers";

const keyboardRows = ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"];
const feedbackLegend = [
  {
    key: "hint",
    title: "Lettre verrouillée",
    body: "Cyan. La lettre est déjà révélée et reste posée automatiquement.",
    letter: "A",
    hint: true,
    tone: "hint" as const
  },
  {
    key: "correct",
    title: "Bien placée",
    body: "Vert. Bonne lettre, bonne case.",
    letter: "A",
    state: "correct" as const,
    tone: "correct" as const
  },
  {
    key: "present",
    title: "Présente",
    body: "Ambre. Bonne lettre, mais mauvaise case.",
    letter: "A",
    state: "present" as const,
    tone: "present" as const
  },
  {
    key: "absent",
    title: "Éliminée",
    body: "Ardoise. Lettre absente du mot quand l'état est confirmé.",
    letter: "A",
    state: "absent" as const,
    tone: "absent" as const
  }
];

function formatRemaining(target?: number | null, now = Date.now()) {
  if (!target) {
    return "--:--";
  }

  const remaining = Math.max(0, target - now);
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${rest}`;
}

function toLegacySeatReservation(reservation: SeatReservation) {
  if (!reservation.processId) {
    throw new Error("Ticket de room incomplet: processId manquant.");
  }

  return {
    sessionId: reservation.sessionId,
    room: {
      name: reservation.name,
      roomId: reservation.roomId,
      processId: reservation.processId,
      publicAddress: reservation.publicAddress
    },
    reconnectionToken: reservation.reconnectionToken,
    devMode: reservation.devMode,
    protocol: "ws"
  };
}

export function PlayShell() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [isBusy, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string>("Prêt pour la première room.");
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [boardSnapshot, setBoardSnapshot] = useState<BoardSnapshot | null>(null);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [guess, setGuess] = useState("");
  const [privateCode, setPrivateCode] = useState("");
  const [authMode, setAuthMode] = useState<"upgrade" | "signin">("upgrade");
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [isInputFocused, setIsInputFocused] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  const previousBoardRef = useRef<BoardSnapshot | null>(null);

  const deferredSnapshot = useDeferredValue(roomSnapshot);
  const sessionUser = session?.user as { id: string; name: string; email: string; isAnonymous?: boolean } | undefined;
  const localPlayer = useMemo(
    () => deferredSnapshot?.players.find((player) => player.userId === sessionUser?.id) ?? null,
    [deferredSnapshot, sessionUser?.id]
  );
  const isInRoom = Boolean(roomSnapshot);
  const roomPhase = deferredSnapshot?.phase ?? null;
  const timeValue =
    roomPhase === "round"
      ? formatRemaining(deferredSnapshot?.roundEndsAt, now)
      : formatRemaining(deferredSnapshot?.countdownEndsAt, now);
  const boardIsStale = Boolean(
    boardSnapshot && roomPhase === "round" && deferredSnapshot && boardSnapshot.roundIndex !== deferredSnapshot.currentRoundIndex
  );
  const liveBoardSnapshot = boardIsStale ? null : boardSnapshot;
  const keyboardStates = useMemo(() => buildKeyboardLetterStates(liveBoardSnapshot), [liveBoardSnapshot]);
  const blockedLetters = useMemo(() => getBlockedLetters(liveBoardSnapshot), [liveBoardSnapshot]);
  const currentRoundNumber = deferredSnapshot ? deferredSnapshot.currentRoundIndex + 1 : 0;
  const revealWord = liveBoardSnapshot?.solution;
  const showRoundReveal = Boolean(liveBoardSnapshot?.roundResolved && revealWord);
  const roundTitle =
    roomPhase === "round"
      ? `Round ${currentRoundNumber}`
      : roomPhase === "intermission"
        ? `Fin du round ${currentRoundNumber}`
        : roomPhase === "results"
          ? "Résultats"
          : roomPhase === "countdown"
            ? "Départ imminent"
            : roomPhase === "queue"
              ? "Queue publique"
              : "Lobby privé";
  const roundSubtitle =
    roomPhase === "round"
      ? "Même mot pour tout le monde. Plus rapide et plus propre gagne."
      : roomPhase === "intermission"
        ? revealWord
          ? `Réponse affichée. Reprise dans ${timeValue}.`
          : "Transition vers la prochaine manche."
        : roomPhase === "results"
          ? "Podium final, score total et dernier mot joué."
          : roomPhase === "countdown"
            ? `Le round ${currentRoundNumber} démarre dans ${timeValue}.`
            : roomPhase === "queue"
              ? "Attends l’arrivée du field minimum ou crée une room privée."
              : "Invite un autre joueur ou lance la room quand tout le monde est prêt.";
  const isLiveRound = Boolean(liveBoardSnapshot && roomPhase === "round" && localPlayer?.status === "playing");

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.removeAllListeners();
      void roomRef.current?.leave(true);
    };
  }, []);

  useEffect(() => {
    if (!sessionUser && roomRef.current) {
      roomRef.current.removeAllListeners();
      void roomRef.current.leave(true);
      roomRef.current = null;
      clientRef.current = null;
      setRoomSnapshot(null);
      setBoardSnapshot(null);
      setMatchSummary(null);
    }
  }, [sessionUser]);

  useEffect(() => {
    if (!boardSnapshot) {
      previousBoardRef.current = null;
      setGuess("");
      return;
    }

    const previousBoard = previousBoardRef.current;
    const roundChanged =
      !previousBoard ||
      previousBoard.roundIndex !== boardSnapshot.roundIndex ||
      previousBoard.wordLength !== boardSnapshot.wordLength;
    const lockSignatureChanged =
      !previousBoard ||
      previousBoard.revealedIndexes.join(",") !== boardSnapshot.revealedIndexes.join(",") ||
      previousBoard.hintLetters.join("") !== boardSnapshot.hintLetters.join("");

    if (roundChanged) {
      setGuess("");
    } else if (lockSignatureChanged && previousBoard) {
      setGuess((current) => extractEditableGuess(composeGuessDraft(current, previousBoard), boardSnapshot, blockedLetters));
    }

    previousBoardRef.current = boardSnapshot;
  }, [blockedLetters, boardSnapshot]);

  useEffect(() => {
    if (boardIsStale) {
      setGuess("");
    }
  }, [boardIsStale]);

  useEffect(() => {
    if (liveBoardSnapshot && roomPhase === "round" && localPlayer?.status === "playing") {
      if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768) {
        return;
      }

      guessInputRef.current?.focus({ preventScroll: true });
    }
  }, [liveBoardSnapshot?.roundIndex, localPlayer?.status, roomPhase]);

  async function connectToRoom(endpoint: string, body?: Record<string, unknown>) {
    if (!sessionUser) {
      setStatusMessage("Crée d’abord une session invitée ou connecte-toi.");
      return;
    }

    try {
      setStatusMessage("Création du ticket de jeu…");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });

      const payload = (await response.json()) as TicketBundle & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Ticket refusé.");
      }

      roomRef.current?.removeAllListeners();
      if (roomRef.current) {
        await roomRef.current.leave(true);
      }

      startTransition(() => {
        setRoomSnapshot(null);
        setBoardSnapshot(null);
        setMatchSummary(null);
        setGuess("");
      });

      const client = new Client(payload.wsEndpoint);
      client.auth.token = payload.token;
      const room = await client.consumeSeatReservation(toLegacySeatReservation(payload.reservation) as never);

      clientRef.current = client;
      roomRef.current = room;

      room.onMessage<RoomSnapshot>("phase:update", (snapshot) => {
        startTransition(() => {
          setBoardSnapshot((current) => {
            if (!current) {
              return current;
            }

            if (snapshot.phase === "round" && current.roundIndex !== snapshot.currentRoundIndex) {
              return null;
            }

            return current;
          });
          setRoomSnapshot(snapshot);
        });
      });

      room.onMessage<BoardSnapshot>("board:snapshot", (snapshot) => {
        startTransition(() => {
          setBoardSnapshot(snapshot);
        });
      });

      room.onMessage<GuessResult>("guess:result", (result) => {
        if (result.error) {
          setStatusMessage(result.error);
          return;
        }

        if (typeof result.clueRevealedIndex === "number") {
          setStatusMessage(`Indice débloqué sur la case ${result.clueRevealedIndex + 1}.`);
          return;
        }

        if (result.solved) {
          setStatusMessage(`Mot trouvé. +${result.scoreDelta} points.`);
        } else if (result.isValid) {
          setStatusMessage("Mot accepté, poursuis.");
        }
      });

      room.onMessage<MatchSummary>("match:summary", (summary) => {
        startTransition(() => {
          setMatchSummary(summary);
        });
      });

      room.onError((code, message) => {
        setStatusMessage(`Erreur room ${code}: ${message ?? "inconnue"}`);
      });

      room.onLeave((code, reason) => {
        setStatusMessage(`Connexion room fermée (${code})${reason ? `: ${reason}` : ""}`);
      });

      room.send("request_sync");
      setStatusMessage(payload.roomCode ? `Room privée ${payload.roomCode} connectée.` : "Matchmaking public démarré.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Connexion impossible.");
    }
  }

  async function continueAsGuest() {
    const result = await authClient.signIn.anonymous();

    if (result.error) {
      setStatusMessage(result.error.message ?? "Impossible de créer la session invitée.");
      return;
    }

    await refetch();
    setStatusMessage("Session invitée prête.");
  }

  async function signUpEmail() {
    const result = await authClient.signUp.email({
      name: nameInput || sessionUser?.name || "Motus Player",
      email: emailInput,
      password: passwordInput
    });

    if (result.error) {
      setStatusMessage(result.error.message ?? "Création de compte impossible.");
      return;
    }

    await refetch();
    setStatusMessage("Compte créé et lié à ta session.");
    setPasswordInput("");
  }

  async function signInEmail() {
    const result = await authClient.signIn.email({
      email: emailInput,
      password: passwordInput
    });

    if (result.error) {
      setStatusMessage(result.error.message ?? "Connexion impossible.");
      return;
    }

    await refetch();
    setStatusMessage("Connexion réussie.");
    setPasswordInput("");
  }

  async function addPasskey() {
    const result = await authClient.passkey.addPasskey({
      name: "Primary device"
    });

    if (result.error) {
      setStatusMessage(result.error.message ?? "Impossible d’ajouter une passkey.");
      return;
    }

    setStatusMessage("Passkey enregistrée.");
  }

  async function signInWithPasskey() {
    const result = await authClient.signIn.passkey();

    if (result.error) {
      setStatusMessage(result.error.message ?? "Connexion passkey impossible.");
      return;
    }

    await refetch();
    setStatusMessage("Connexion passkey réussie.");
  }

  async function signOut() {
    await authClient.signOut();
    await refetch();
    setStatusMessage("Session fermée.");
  }

  function handleUpgradeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signUpEmail();
  }

  function handleSignInSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signInEmail();
  }

  function submitGuess() {
    if (!liveBoardSnapshot || !roomRef.current || roomPhase !== "round") {
      return;
    }

    const normalized = composeGuessDraft(guess, liveBoardSnapshot, blockedLetters);

    if (normalized.length !== liveBoardSnapshot.wordLength) {
      setStatusMessage(`Il faut ${liveBoardSnapshot.wordLength} lettres.`);
      return;
    }

    roomRef.current.send("guess", { value: normalized });
    setGuess("");
  }

  function appendLetter(letter: string) {
    if (!liveBoardSnapshot || roomPhase !== "round") {
      return;
    }

    if (blockedLetters.has(letter)) {
      setStatusMessage(`"${letter}" est éliminée pour ce round.`);
      return;
    }

    setGuess((current) => extractEditableGuess(`${current}${letter}`, liveBoardSnapshot, blockedLetters));
  }

  function removeLetter() {
    setGuess((current) => current.slice(0, -1));
  }

  function getKeyboardTone(letter: string): KeyboardLetterState {
    return keyboardStates.get(letter) ?? "unused";
  }

  function getKeyboardButtonClass(tone: KeyboardLetterState): string {
    return clsx(
      "relative flex h-12 w-full items-center justify-center overflow-hidden rounded-xl border px-1 text-base sm:text-lg transition sm:h-14 sm:rounded-2xl sm:px-2",
      tone === "correct" && "border-lime-200/85 bg-lime-300 text-slate-950 shadow-[0_12px_22px_rgba(178,255,82,0.16)]",
      tone === "present" && "border-amber-200/85 bg-amber-300 text-slate-950 shadow-[0_10px_18px_rgba(255,190,85,0.14)]",
      tone === "hint" && "border-cyan-200/70 bg-cyan-300 text-slate-950",
      tone === "absent" && "cursor-not-allowed border-slate-700/90 bg-slate-800 text-slate-300",
      tone === "unused" &&
        "border-white/10 bg-white/[0.04] text-white hover:border-cyan-300/40 hover:bg-cyan-300/10 focus-visible:border-cyan-300/45"
    );
  }

  function renderKeyboardToneDecor(tone: KeyboardLetterState) {
    if (tone === "unused") {
      return null;
    }

    const iconTone = tone === "hint" || tone === "correct" || tone === "present" || tone === "absent" ? tone : null;

    return (
      <span
        className={clsx(
          "pointer-events-none absolute right-1.5 top-1.5 z-10 flex h-4.5 w-4.5 items-center justify-center rounded-full border",
          iconTone === "correct" && "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "present" && "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "absent" && "border-white/10 bg-slate-950/45 text-slate-200",
          iconTone === "hint" && "border-cyan-950/12 bg-slate-950/12 text-slate-950"
        )}
      >
        <FeedbackToneIcon tone={iconTone as Exclude<WordTileTone, "idle" | "pending">} className="h-2.5 w-2.5" />
      </span>
    );
  }

  function getKeyboardAriaLabel(letter: string): string {
    const tone = getKeyboardTone(letter);

    if (tone === "correct") {
      return `${letter}, bonne lettre bien placée`;
    }

    if (tone === "present") {
      return `${letter}, bonne lettre mal placée`;
    }

    if (tone === "hint") {
      return `${letter}, lettre révélée et verrouillée`;
    }

    if (tone === "absent") {
      return `${letter}, lettre éliminée`;
    }

    return letter;
  }

  const liveRows = liveBoardSnapshot?.rows ?? [];
  const lockedLetters = useMemo(() => getLockedLetters(liveBoardSnapshot), [liveBoardSnapshot]);
  const guessDraft = useMemo(
    () => composeGuessDraft(guess, liveBoardSnapshot, blockedLetters),
    [blockedLetters, liveBoardSnapshot, guess]
  );
  const editableSlotCount = useMemo(() => getEditableSlotCount(liveBoardSnapshot), [liveBoardSnapshot]);
  const displayRows = useMemo(() => {
    if (!liveBoardSnapshot) {
      return [];
    }

    const rows: Array<Array<{ letter: string; state?: "correct" | "present" | "absent" | "pending"; hint?: boolean }>> = [];

    for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
      const existing = liveRows[rowIndex];

      if (existing) {
        rows.push(
          existing.tiles.map((tile, index) => ({
            letter: existing.guess[index] ?? "",
            state: tile,
            hint: liveBoardSnapshot.revealedIndexes.includes(index)
          }))
        );
        continue;
      }

      const isCurrentRow = rowIndex === liveRows.length && roomPhase === "round" && localPlayer?.status === "playing";

      rows.push(
        Array.from({ length: liveBoardSnapshot.wordLength }, (_, index) => {
          const typedLetter = isCurrentRow ? guessDraft[index] ?? "" : "";
          const hintLetter = !typedLetter ? lockedLetters[index] ?? "" : "";
          const isLockedCell = Boolean(lockedLetters[index]);

          return {
            letter: typedLetter || hintLetter,
            state: typedLetter && !isLockedCell ? "pending" : undefined,
            hint: Boolean(hintLetter)
          };
        })
      );
    }

    return rows;
  }, [guessDraft, liveBoardSnapshot, liveRows, localPlayer?.status, lockedLetters, roomPhase]);

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <GlassPanel className="flex-1 flex flex-col p-4 sm:p-5 md:p-6 min-h-0">
        <div
          className={clsx(
            "flex-1 grid items-stretch gap-6 lg:gap-8 min-h-0",
            isInRoom ? "grid-cols-1" : "lg:grid-cols-[1.15fr_0.85fr]"
          )}
        >
          <div className="min-w-0 flex flex-col space-y-6 min-h-0">
            {!isInRoom ? (
              <SectionHeader
                eyebrow="Game Console"
                title="Queue, room privée, partie live"
                body="Une seule surface pour l’auth, le ticketing et le runtime realtime. Tu peux démarrer en invité puis upgrader sans casser ton profil."
              />
            ) : null}

            {!sessionUser ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Instant Guest</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">Entrer en 1 clic</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Session invitée Better Auth, pseudo généré, puis création de ticket côté serveur seulement.
                  </p>
                  <button className="button-primary mt-5 w-full" onClick={continueAsGuest} disabled={isPending || isBusy}>
                    Continuer en invité
                  </button>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Passkey / Email</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">Compte existant</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Connecte-toi avec une passkey déjà enregistrée ou avec ton couple email / mot de passe.
                  </p>
                  <button className="button-secondary mt-5 w-full" onClick={signInWithPasskey} disabled={isPending || isBusy}>
                    Se connecter avec passkey
                  </button>
                </div>
              </div>
            ) : !roomSnapshot ? (
              <div className="grid gap-5 xl:grid-cols-[1fr_0.92fr]">
                <div className="min-w-0 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <button className="button-primary w-full" onClick={() => void connectToRoom("/api/game/public-ticket")} disabled={isBusy}>
                      Rejoindre la queue publique
                    </button>
                    <button className="button-secondary w-full" onClick={() => void connectToRoom("/api/game/private-ticket")} disabled={isBusy}>
                      Créer une room privée
                    </button>
                  </div>

                  <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                    <p className="eyebrow">Join By Code</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        className="input-shell"
                        placeholder="AB12CD"
                        value={privateCode}
                        onChange={(event) => setPrivateCode(event.target.value.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect="off"
                      />
                      <button
                        className="button-primary md:min-w-44"
                        onClick={() => void connectToRoom("/api/game/private-join", { roomCode: privateCode })}
                        disabled={!privateCode || isBusy}
                      >
                        Entrer dans la room
                      </button>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="eyebrow">Account</p>
                      <h3 className="mt-2 break-words font-display text-2xl text-white sm:text-3xl">{sessionUser.name}</h3>
                      <p className="mt-2 break-all text-sm text-slate-300">{sessionUser.email}</p>
                    </div>
                    <MetricBadge label="Mode" value={sessionUser.isAnonymous ? "Guest" : "Account"} />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button className="button-secondary flex-1" onClick={() => setAuthMode("upgrade")}>
                      Upgrade
                    </button>
                    <button className="button-secondary flex-1" onClick={() => setAuthMode("signin")}>
                      Sign in
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    {authMode === "upgrade" ? (
                      <form className="space-y-3" onSubmit={handleUpgradeSubmit}>
                        <input
                          className="input-shell"
                          placeholder="Nom affiché"
                          value={nameInput}
                          onChange={(event) => setNameInput(event.target.value)}
                          autoComplete="nickname"
                        />
                        <input
                          className="input-shell"
                          placeholder="email@domaine.com"
                          type="email"
                          value={emailInput}
                          onChange={(event) => setEmailInput(event.target.value)}
                          autoComplete="email"
                        />
                        <input
                          className="input-shell"
                          placeholder="Mot de passe"
                          type="password"
                          value={passwordInput}
                          onChange={(event) => setPasswordInput(event.target.value)}
                          autoComplete="new-password"
                        />
                        <button className="button-primary w-full" type="submit" disabled={!emailInput || !passwordInput}>
                          Créer / lier mon compte
                        </button>
                      </form>
                    ) : (
                      <form className="space-y-3" onSubmit={handleSignInSubmit}>
                        <input
                          className="input-shell"
                          placeholder="email@domaine.com"
                          type="email"
                          value={emailInput}
                          onChange={(event) => setEmailInput(event.target.value)}
                          autoComplete="email"
                        />
                        <input
                          className="input-shell"
                          placeholder="Mot de passe"
                          type="password"
                          value={passwordInput}
                          onChange={(event) => setPasswordInput(event.target.value)}
                          autoComplete="current-password"
                        />
                        <button className="button-primary w-full" type="submit" disabled={!emailInput || !passwordInput}>
                          Se connecter
                        </button>
                      </form>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button className="button-secondary w-full" onClick={addPasskey}>
                        Ajouter une passkey
                      </button>
                      <button className="button-danger w-full" onClick={signOut}>
                        Fermer la session
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_23rem]">
                <div className="min-w-0 space-y-5">
                  <div className="flex flex-wrap gap-2 sm:gap-3">
                    <MetricBadge label="Phase" value={roomSnapshot.phase.toUpperCase()} />
                    <MetricBadge label="Timer" value={timeValue} tone={roomPhase === "round" ? "danger" : "default"} />
                    <MetricBadge label="Room" value={roomSnapshot.roomCode ?? "Public"} />
                    <MetricBadge label="Modifier" value={roomSnapshot.modifier ?? "standard"} tone="good" />
                  </div>

                  <div
                    className={clsx(
                      "rounded-[30px] border border-white/8 bg-slate-950/72 p-4 sm:p-5",
                      isLiveRound && "flex flex-col h-full md:pb-5"
                    )}
                  >
                    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow">Live Match</p>
                        <h3 className="mt-2 font-display text-3xl text-white sm:text-4xl">{roundTitle}</h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{roundSubtitle}</p>
                        <p className="mt-3 text-sm text-slate-400 md:hidden" aria-live="polite">
                          {statusMessage}
                        </p>
                      </div>

                      <div className="grid gap-2 sm:min-w-40">
                        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <p className="eyebrow">You</p>
                          <p className="number-tabular text-3xl font-semibold text-white">{localPlayer?.score ?? 0}</p>
                        </div>
                        {liveBoardSnapshot ? (
                          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                            <p className="eyebrow">Essais restants</p>
                            <p className="number-tabular text-2xl font-semibold text-white">{liveBoardSnapshot.attemptsRemaining}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {showRoundReveal ? (
                      <div className="mx-auto mb-5 w-full max-w-[38rem] rounded-[24px] border border-amber-300/20 bg-amber-300/10 px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="eyebrow">Réponse du round {currentRoundNumber}</p>
                            <p className="mt-2 break-words font-display text-3xl uppercase tracking-[0.18em] text-white sm:text-4xl">
                              {revealWord}
                            </p>
                          </div>
                          <MetricBadge
                            label="Bilan"
                            value={liveBoardSnapshot?.roundSolved ? "Trouvé" : "Raté"}
                            tone={liveBoardSnapshot?.roundSolved ? "good" : "danger"}
                          />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-amber-50/90">
                          {liveBoardSnapshot?.roundSolved
                            ? `+${liveBoardSnapshot.roundScore} points sur cette manche.`
                            : "Le mot est affiché pour repartir proprement sur la manche suivante."}
                        </p>
                      </div>
                    ) : null}

                    {boardIsStale ? (
                      <div className="mx-auto w-full max-w-[38rem] rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                        <p className="eyebrow">Sync</p>
                        <p className="mt-2 font-display text-2xl text-white">Chargement du nouveau mot…</p>
                        <p className="mt-2 text-sm text-slate-400">L’ancien board est masqué jusqu’à la réception du bon round.</p>
                      </div>
                    ) : liveBoardSnapshot ? (
                      <div className="mx-auto w-full max-w-[38rem] space-y-2 sm:space-y-3">
                        {displayRows.map((row, rowIndex) => (
                          <div
                            key={rowIndex}
                            className="grid gap-2 sm:gap-3"
                            style={{ gridTemplateColumns: `repeat(${liveBoardSnapshot.wordLength}, minmax(0, 1fr))` }}
                          >
                            {row.map((cell, columnIndex) => (
                              <WordTile key={`${rowIndex}-${columnIndex}`} letter={cell.letter} state={cell.state} hint={cell.hint} />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mx-auto w-full max-w-[38rem] rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                        <p className="eyebrow">Pré-match</p>
                        <p className="mt-2 text-sm text-slate-300">La grille arrive avec le démarrage du round.</p>
                      </div>
                    )}

                    {isLiveRound && (
                      <div className="mx-auto mt-auto w-full max-w-[38rem] sticky bottom-0 pt-4 z-30">
                        <div className="rounded-[24px] border border-white/10 bg-slate-950/96 p-3 shadow-[0_-10px_44px_rgba(0,0,0,0.5)] backdrop-blur md:static md:bottom-auto md:inset-x-auto md:w-full md:max-w-none md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0">
                          <div className="mb-3 flex flex-wrap gap-2 md:hidden">
                            {feedbackLegend.map((item) => (
                              <span
                                key={item.key}
                                className={clsx(
                                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium",
                                  item.tone === "correct" && "border-lime-300/30 bg-lime-300/10 text-lime-50",
                                  item.tone === "present" && "border-amber-300/30 bg-amber-300/10 text-amber-50",
                                  item.tone === "hint" && "border-cyan-300/30 bg-cyan-300/10 text-cyan-50",
                                  item.tone === "absent" && "border-slate-400/25 bg-slate-400/10 text-slate-200"
                                )}
                              >
                                <FeedbackToneIcon tone={item.tone} className="h-3 w-3" />
                                {item.title}
                              </span>
                            ))}
                          </div>

                          <div className="mb-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3.5 py-3 md:hidden">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Saisie</p>
                            <p className="mt-1 text-sm leading-5 text-slate-300">
                              {editableSlotCount > 1 ? `${editableSlotCount} lettres à remplir.` : "Une seule case à remplir."}
                            </p>
                            <p className="mt-2 text-xs text-slate-400" aria-live="polite">
                              {statusMessage}
                            </p>
                          </div>

                          <div className="mb-3 hidden rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 md:block">
                            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Saisie</p>
                            <p className="mt-2 text-sm leading-6 text-slate-300">
                              Les lettres révélées restent verrouillées automatiquement. Tu saisis seulement les{" "}
                              {editableSlotCount > 1 ? `${editableSlotCount} lettres manquantes` : "lettres encore ouvertes"}.
                            </p>
                            <p className="mt-2 text-xs leading-5 text-slate-400">
                              Cyan = verrouillé. Vert = bonne case. Ambre = bonne lettre ailleurs. Ardoise = absente.
                            </p>
                          </div>

                          <form
                            className="space-y-3"
                            onSubmit={(event) => {
                              event.preventDefault();
                              submitGuess();
                            }}
                          >
                            <input
                              ref={guessInputRef}
                              className="input-shell"
                              value={guess}
                              onFocus={() => setIsInputFocused(true)}
                              onBlur={() => setIsInputFocused(false)}
                              onChange={(event) => setGuess(extractEditableGuess(event.target.value, liveBoardSnapshot, blockedLetters))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  submitGuess();
                                  return;
                                }

                                if (event.key.length === 1) {
                                  const typedLetter = event.key.toUpperCase();

                                  if (blockedLetters.has(typedLetter)) {
                                    event.preventDefault();
                                    setStatusMessage(`"${typedLetter}" est éliminée pour ce round.`);
                                  }
                                }
                              }}
                              placeholder={createEditableGuessPlaceholder(liveBoardSnapshot)}
                              aria-label="Saisir les lettres restantes"
                              autoCapitalize="characters"
                              autoComplete="off"
                              autoCorrect="off"
                              enterKeyHint="done"
                              inputMode="text"
                              maxLength={editableSlotCount}
                              spellCheck={false}
                            />
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                className="button-secondary w-full"
                                type="button"
                                onClick={() => roomRef.current?.send("use_clue")}
                                disabled={!(liveBoardSnapshot?.canUseClue ?? false)}
                              >
                                Indice
                              </button>
                              <button className="button-primary w-full" type="submit">
                                Valider
                              </button>
                              <button className="button-secondary w-full" type="button" onClick={removeLetter}>
                                Effacer
                              </button>
                            </div>
                          </form>

                          <div className={clsx("mt-3 space-y-1.5 sm:space-y-2", isInputFocused && "hidden md:block")}>
                            {keyboardRows.map((row) => (
                              <div
                                key={row}
                                className="mx-auto grid max-w-[38rem] gap-1.5 sm:gap-2"
                                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
                              >
                                {row.split("").map((letter) => {
                                  const tone = getKeyboardTone(letter);

                                  return (
                                    <button
                                      key={letter}
                                      aria-label={getKeyboardAriaLabel(letter)}
                                      className={getKeyboardButtonClass(tone)}
                                      disabled={blockedLetters.has(letter)}
                                      type="button"
                                      onClick={() => appendLetter(letter)}
                                    >
                                      {renderKeyboardToneDecor(tone)}
                                      <span className="relative z-10">{letter}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {roomPhase === "lobby" || roomPhase === "queue" || roomPhase === "countdown" ? (
                      <div className="mt-5 flex flex-wrap gap-3">
                        {roomSnapshot.roomKind === "private" && (
                          <>
                            <button className="button-secondary w-full sm:w-auto" onClick={() => roomRef.current?.send("set_ready")}>
                              {localPlayer?.status === "ready" ? "Unready" : "Ready"}
                            </button>
                            {sessionUser?.id === roomSnapshot.hostUserId && (
                              <button className="button-primary w-full sm:w-auto" onClick={() => roomRef.current?.send("start_match")}>
                                Lancer la partie
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid min-w-0 gap-5 lg:grid-cols-2 xl:sticky xl:top-6 xl:grid-cols-1">
                  <div className="hidden rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5 xl:block">
                    <p className="eyebrow">Current Session</p>
                    <h3 className="mt-3 break-words font-display text-2xl text-white sm:text-3xl">{sessionUser?.name}</h3>
                    <p className="mt-2 break-all text-sm text-slate-300">{sessionUser?.email}</p>
                    <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                      <MetricBadge label="Auth" value={sessionUser?.isAnonymous ? "Guest" : "Account"} />
                      <MetricBadge label="WS" value="Connected" tone="good" />
                    </div>
                  </div>

                  <div className="hidden rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5 xl:block">
                    <p className="eyebrow">Lecture Express</p>
                    <div className="mt-4 space-y-3">
                      {feedbackLegend.map((item) => (
                        <div key={item.key} className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                          <div className="w-11 shrink-0">
                            <WordTile letter={item.letter} state={item.state} hint={item.hint} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <FeedbackToneIcon tone={item.tone} className="h-3.5 w-3.5 text-slate-200" />
                              <p className="text-sm font-medium text-white">{item.title}</p>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-400">{item.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow">Leaderboard Rail</p>
                        <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">Classement live</h3>
                      </div>
                      <MetricBadge label="Players" value={deferredSnapshot?.players.length ?? roomSnapshot.players.length} />
                    </div>

                    <div className="mt-5 space-y-3">
                      {(deferredSnapshot?.players ?? roomSnapshot.players).map((player, index) => (
                        <div
                          key={player.userId}
                          className={clsx(
                            "rounded-[22px] border px-4 py-3 transition",
                            player.userId === sessionUser?.id ? "border-cyan-300/35 bg-cyan-300/10" : "border-white/8 bg-white/[0.03]"
                          )}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 flex items-center gap-3">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-sm text-white">
                                #{index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="break-words font-medium text-white">{player.name}</p>
                                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{player.status}</p>
                              </div>
                            </div>
                            <span className="number-tabular text-sm text-slate-200">{player.score} pts</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={clsx("rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5", isLiveRound && "hidden lg:block")}>
                    <p className="eyebrow">Status Feed</p>
                    <p className="mt-3 text-sm leading-6 text-slate-200" aria-live="polite">
                      {statusMessage}
                    </p>

                    {matchSummary && (
                      <div className="mt-5 space-y-3">
                        <p className="eyebrow">Podium</p>
                        {matchSummary.players.slice(0, 3).map((player) => (
                          <div key={player.userId} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-white">
                                #{player.placement} {player.name}
                              </span>
                              <span className="number-tabular text-sm text-slate-200">{player.score}</span>
                            </div>
                          </div>
                        ))}

                        <div className="grid gap-3 sm:grid-cols-2">
                          <button className="button-primary w-full" onClick={() => void connectToRoom("/api/game/public-ticket")}>
                            Relancer en public
                          </button>
                          <button className="button-secondary w-full" onClick={() => void connectToRoom("/api/game/private-ticket")}>
                            Nouvelle room privée
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isInRoom ? (
            <div className="min-w-0 space-y-5">
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                <p className="eyebrow">Current Session</p>
                <h3 className="mt-3 break-words font-display text-2xl text-white sm:text-3xl">
                  {sessionUser?.name ?? "Aucune session"}
                </h3>
                <p className="mt-2 break-all text-sm text-slate-300">{sessionUser?.email ?? "Passe par invité ou email."}</p>
                <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                  <MetricBadge label="Auth" value={sessionUser?.isAnonymous ? "Guest" : sessionUser ? "Account" : "None"} />
                  <MetricBadge label="WS" value={roomSnapshot ? "Connected" : "Idle"} tone={roomSnapshot ? "good" : "default"} />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                <p className="eyebrow">Ruleset</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  <li>1. Tout le monde reçoit le même mot, avec des lettres verrouillées affichées en cyan.</li>
                  <li>2. Vert = bonne lettre à la bonne place, ambre = bonne lettre à une autre place, ardoise = lettre absente.</li>
                  <li>3. Score = résolution + vitesse + efficacité, puis cut après le round 4 et finale top 4.</li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}
