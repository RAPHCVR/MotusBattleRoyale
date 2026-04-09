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
  getKnownLetterLimits,
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

type PendingAction =
  | "guest"
  | "public"
  | "private"
  | "privateJoin"
  | "upgrade"
  | "signin"
  | "passkeyAdd"
  | "passkeySignIn"
  | "signOut"
  | null;

type MatchPhase = RoomSnapshot["phase"] | null;

function getPhaseBadgeValue(phase: MatchPhase) {
  switch (phase) {
    case "round":
      return "En manche";
    case "intermission":
      return "Pause";
    case "results":
      return "Finale";
    case "countdown":
      return "Décompte";
    case "queue":
      return "Public";
    case "lobby":
      return "Privé";
    default:
      return "Hors partie";
  }
}

function getModeLabel(modifier?: string | null) {
  if (!modifier || modifier === "standard") {
    return "Standard";
  }

  return modifier
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getPlayerStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "En attente";
    case "ready":
      return "Prêt";
    case "playing":
      return "En jeu";
    case "solved":
      return "Trouvé";
    case "eliminated":
      return "Éliminé";
    case "spectating":
      return "Spectateur";
    case "left":
      return "Parti";
    default:
      return status;
  }
}

function formatPlayerCount(count: number | null | undefined) {
  const safeCount = Math.max(0, count ?? 0);
  return `${safeCount} ${safeCount > 1 ? "joueurs" : "joueur"}`;
}

function getEliminationStatusCopy(roundNumber: number, finalistsCount: number) {
  if (finalistsCount > 0 || roundNumber >= 6) {
    return "Tu n’as pas passé la sélection finale. La partie continue en observation, sans saisie.";
  }

  if (roundNumber >= 4) {
    return "Tu as été sorti à la coupe intermédiaire. Tu peux suivre la suite, mais la saisie est coupée.";
  }

  return "Tu n’es plus en course sur ce match. Le classement reste visible, la saisie est désactivée.";
}

function isOperationalStatusMessage(message: string) {
  const lower = message.toLowerCase();
  return [
    "erreur",
    "impossible",
    "connexion",
    "création",
    "session",
    "compte",
    "passkey",
    "salon",
    "match public",
    "recherche",
    "préparation",
    "chargement",
    "fermée"
  ].some((token) => lower.includes(token));
}

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

function toLegacySeatReservation(reservation: SeatReservation, wsEndpoint: string) {
  if (!reservation.processId) {
    throw new Error("Ticket de room incomplet: processId manquant.");
  }

  let publicAddress = reservation.publicAddress;

  try {
    const endpoint = new URL(wsEndpoint);
    publicAddress = `${endpoint.host}${endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/$/, "")}`;
  } catch {
    // Keep the reservation address when the endpoint cannot be parsed.
  }

  return {
    sessionId: reservation.sessionId,
    room: {
      name: reservation.name,
      roomId: reservation.roomId,
      processId: reservation.processId,
      publicAddress
    },
    reconnectionToken: reservation.reconnectionToken,
    devMode: reservation.devMode,
    protocol: "ws"
  };
}

export function PlayShell() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [isBusy, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string>("Prêt pour la première partie.");
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
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  const previousBoardRef = useRef<BoardSnapshot | null>(null);
  const previousPlayerStatusRef = useRef<string | null>(null);
  const playSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [prefersTouchInput, setPrefersTouchInput] = useState(false);
  const [showDesktopKeyboard, setShowDesktopKeyboard] = useState(false);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);

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
  const knownLetterLimits = useMemo(() => getKnownLetterLimits(liveBoardSnapshot), [liveBoardSnapshot]);
  const eliminatedLetters = useMemo(
    () => Array.from(blockedLetters).sort((left, right) => left.localeCompare(right, "fr")),
    [blockedLetters]
  );
  const currentRoundNumber = deferredSnapshot ? deferredSnapshot.currentRoundIndex + 1 : 0;
  const finalistsCount = deferredSnapshot?.finalistsCount ?? 0;
  const activePlayerCount = deferredSnapshot?.activePlayerCount ?? roomSnapshot?.players.length ?? 0;
  const localStatus = localPlayer?.status ?? null;
  const localStatusLabel = localStatus ? getPlayerStatusLabel(localStatus) : "Hors partie";
  const revealWord = liveBoardSnapshot?.solution;
  const showRoundReveal = Boolean(liveBoardSnapshot?.roundResolved && revealWord);
  const statusDrivenSubtitle =
    localStatus === "eliminated"
      ? getEliminationStatusCopy(currentRoundNumber, finalistsCount)
      : localStatus === "spectating"
        ? "Tu observes cette phase. La saisie est désactivée."
        : null;
  const roundTitle =
    roomPhase === "round"
      ? `Manche ${currentRoundNumber}`
      : roomPhase === "intermission"
        ? `Fin de la manche ${currentRoundNumber}`
        : roomPhase === "results"
          ? "Résultats"
          : roomPhase === "countdown"
            ? "Départ imminent"
            : roomPhase === "queue"
              ? "Matchmaking public"
              : "Salon privé";
  const roundSubtitle =
    statusDrivenSubtitle ??
    (roomPhase === "round"
      ? `Même mot pour tous. ${formatPlayerCount(activePlayerCount)} encore en course.`
      : roomPhase === "intermission"
        ? revealWord
          ? `Mot révélé. Reprise dans ${timeValue}. ${formatPlayerCount(activePlayerCount)} encore en course.`
          : "Transition vers la prochaine manche."
        : roomPhase === "results"
          ? "Podium final, score cumulé et dernier mot joué."
          : roomPhase === "countdown"
            ? `La manche ${currentRoundNumber} démarre dans ${timeValue}.`
            : roomPhase === "queue"
              ? "Attends assez de joueurs ou crée un salon privé."
              : "Invite un autre joueur ou lance le salon quand tout le monde est prêt.");
  const isLiveRound = Boolean(liveBoardSnapshot && roomPhase === "round" && localPlayer?.status === "playing");
  const phaseBadgeValue = getPhaseBadgeValue(roomPhase);
  const modeLabel = getModeLabel(roomSnapshot?.modifier);
  const fullscreenActive = isFullscreen || isPseudoFullscreen;
  const showCompactReveal = showRoundReveal && (fullscreenActive || prefersTouchInput || (viewportHeight > 0 && viewportHeight <= 880));
  const showVirtualKeyboard = prefersTouchInput ? fullscreenActive && showTouchKeyboard : showDesktopKeyboard;
  const isSubmittingSession = pendingAction === "guest" || pendingAction === "upgrade" || pendingAction === "signin" || pendingAction === "passkeySignIn";
  const isConnectingToRoom = pendingAction === "public" || pendingAction === "private" || pendingAction === "privateJoin";
  const publicTicketPending = pendingAction === "public";
  const privateTicketPending = pendingAction === "private";
  const privateJoinPending = pendingAction === "privateJoin";
  const lockedSidebarToDesktop = isLiveRound && !prefersTouchInput;
  const compactTouchRound = isLiveRound && prefersTouchInput;
  const compactDesktopRound = isLiveRound && !prefersTouchInput && viewportHeight > 0 && viewportHeight <= 860;
  const desktopVisualKeyboardOpen = isLiveRound && !prefersTouchInput && showVirtualKeyboard;
  const compactDesktopKeyboard = desktopVisualKeyboardOpen && (fullscreenActive || compactDesktopRound || (viewportHeight > 0 && viewportHeight <= 920));
  const compactDockLayout = compactTouchRound || compactDesktopKeyboard;
  const denseDesktopBoard = isLiveRound && !prefersTouchInput && (compactDesktopRound || compactDesktopKeyboard);
  const compactLiveRound = compactTouchRound || compactDesktopRound || compactDesktopKeyboard;
  const canToggleFullscreen = isFullscreenSupported || prefersTouchInput;
  const roomCodeLabel = roomSnapshot?.roomCode ?? "Public";
  const matchInfoTitle =
    roomPhase === "results"
      ? "Match terminé"
      : localStatus === "eliminated"
        ? "Élimination"
        : localStatus === "spectating"
          ? "Observation"
          : roomPhase === "queue"
            ? "Matchmaking public"
            : roomPhase === "lobby"
              ? "Salon privé"
              : roomPhase === "countdown"
                ? `Départ manche ${currentRoundNumber}`
                : roomPhase === "intermission"
                  ? `Pause manche ${currentRoundNumber}`
                  : roomPhase === "round"
                    ? `Manche ${currentRoundNumber}`
                    : "Partie";
  const matchInfoBody =
    matchSummary
      ? "Le podium est figé. Tu peux repartir en public ou créer un nouveau salon privé."
      : localStatus === "eliminated"
        ? getEliminationStatusCopy(currentRoundNumber, finalistsCount)
        : localStatus === "spectating"
          ? "Tu observes la suite du match sans pouvoir saisir. Le classement et le mot révélé restent visibles."
          : roomPhase === "queue"
            ? "Attends qu’un match public s’ouvre. L’écran bascule automatiquement dès qu’un salon répond."
            : roomPhase === "lobby"
              ? roomSnapshot?.roomCode
                ? `Salon ${roomSnapshot.roomCode} prêt. Partage le code puis lance quand tout le monde est là.`
                : "Salon privé prêt. Invite un autre joueur puis lance la partie."
              : roomPhase === "countdown"
                ? `La manche ${currentRoundNumber} part dans ${timeValue}. ${formatPlayerCount(activePlayerCount)} encore en course.`
                : roomPhase === "intermission"
                  ? revealWord
                    ? `Réponse affichée: ${revealWord}. ${formatPlayerCount(activePlayerCount)} encore en course.`
                    : "Transition courte avant la prochaine manche."
                  : roomPhase === "results"
                    ? "Le classement final est figé. Tu peux relancer immédiatement une nouvelle partie."
                    : `Même mot pour tous. ${formatPlayerCount(activePlayerCount)} encore en course.`;
  const matchInfoStats =
    roomPhase === "queue" || roomPhase === "lobby"
      ? [
          { label: "Salon", value: roomCodeLabel },
          { label: "Joueurs", value: deferredSnapshot?.players.length ?? roomSnapshot?.players.length ?? 0 },
          { label: "Statut", value: localStatusLabel }
        ]
      : [
          { label: "Encore en course", value: activePlayerCount },
          { label: "Finalistes", value: finalistsCount > 0 ? finalistsCount : "À venir" },
          { label: "Statut", value: localStatusLabel }
        ];
  const showSystemStatusNote = isOperationalStatusMessage(statusMessage) && statusMessage !== matchInfoBody;
  const showInlineStatusMessage = isLiveRound || showSystemStatusNote;
  const liveBoardMaxWidth = isLiveRound
    ? prefersTouchInput
      ? fullscreenActive
        ? "max(13.75rem, min(17rem, calc(100dvh - 24rem)))"
        : "max(12.75rem, min(15rem, calc(100dvh - 29rem)))"
      : compactDesktopKeyboard
        ? "max(16rem, min(18.5rem, calc(100dvh - 27rem)))"
      : compactDesktopRound
        ? "max(17rem, min(20rem, calc(100dvh - 23rem)))"
        : "max(20rem, min(27rem, calc(100dvh - 24rem)))"
    : "34rem";
  const liveDockMaxWidth = isLiveRound
    ? prefersTouchInput
      ? fullscreenActive
        ? "min(100%, 22rem)"
        : "min(100%, 19.5rem)"
      : compactDesktopKeyboard
        ? "min(100%, 24rem)"
      : compactDesktopRound
        ? "max(18rem, min(24rem, calc(100dvh - 19rem)))"
        : "max(22rem, min(31rem, calc(100dvh - 21rem)))"
    : "34rem";
  const virtualKeyboardMaxWidth = compactTouchRound ? "min(100%, 20rem)" : compactDesktopKeyboard ? "min(100%, 24rem)" : "34rem";

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");

    const syncInputMode = () => {
      const prefersTouch = mediaQuery.matches || window.innerWidth < 768;
      const visualViewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);

      setPrefersTouchInput(prefersTouch);
      setViewportHeight(visualViewportHeight);

      if (prefersTouch) {
        setShowDesktopKeyboard(false);
      } else {
        setShowTouchKeyboard(false);
      }
    };

    syncInputMode();

    const handleViewportChange = () => syncInputMode();
    mediaQuery.addEventListener("change", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      mediaQuery.removeEventListener("change", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    const canFullscreen = Boolean(document.fullscreenEnabled && playSurfaceRef.current?.requestFullscreen);
    setIsFullscreenSupported(canFullscreen);

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(playSurfaceRef.current && document.fullscreenElement === playSurfaceRef.current));
    };

    const handleFullscreenError = () => {
      setStatusMessage("Le plein écran n’est pas disponible sur cet appareil.");
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("fullscreenerror", handleFullscreenError);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("fullscreenerror", handleFullscreenError);
    };
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.removeAllListeners();
      void roomRef.current?.leave(true);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenActive) {
      setShowTouchKeyboard(false);
      return;
    }

    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [fullscreenActive]);

  useEffect(() => {
    if (!isPseudoFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPseudoFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPseudoFullscreen]);

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
      const previousBlockedLetters = getBlockedLetters(previousBoard);
      const previousKnownLetterLimits = getKnownLetterLimits(previousBoard);

      setGuess((current) =>
        extractEditableGuess(
          composeGuessDraft(current, previousBoard, previousBlockedLetters, previousKnownLetterLimits),
          boardSnapshot,
          blockedLetters,
          knownLetterLimits
        )
      );
    }

    previousBoardRef.current = boardSnapshot;
  }, [blockedLetters, boardSnapshot, knownLetterLimits]);

  useEffect(() => {
    if (boardIsStale) {
      setGuess("");
    }
  }, [boardIsStale]);

  useEffect(() => {
    const nextStatus = localPlayer?.status ?? null;
    const previousStatus = previousPlayerStatusRef.current;

    if (!nextStatus) {
      previousPlayerStatusRef.current = null;
      return;
    }

    if (nextStatus !== previousStatus) {
      if (nextStatus === "eliminated") {
        setStatusMessage(getEliminationStatusCopy(currentRoundNumber, finalistsCount));
      } else if (nextStatus === "spectating") {
        setStatusMessage("Tu observes cette phase. La saisie est désactivée.");
      }
    }

    previousPlayerStatusRef.current = nextStatus;
  }, [currentRoundNumber, finalistsCount, localPlayer?.status]);

  useEffect(() => {
    if (liveBoardSnapshot && roomPhase === "round" && localPlayer?.status === "playing") {
      if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768) {
        return;
      }

      guessInputRef.current?.focus({ preventScroll: true });
    }
  }, [liveBoardSnapshot?.roundIndex, localPlayer?.status, roomPhase]);

  useEffect(() => {
    if (!isLiveRound) {
      setShowTouchKeyboard(false);
      return;
    }

    const main = document.querySelector("main");
    requestAnimationFrame(() => {
      if (main instanceof HTMLElement) {
        main.scrollTop = 0;
      }
    });
  }, [isLiveRound, liveBoardSnapshot?.roundIndex]);

  async function toggleFullscreen() {
    if (!playSurfaceRef.current) {
      return;
    }

    if (!document.fullscreenEnabled || !playSurfaceRef.current.requestFullscreen || prefersTouchInput) {
      setIsPseudoFullscreen((current) => !current);
      return;
    }

    try {
      if (document.fullscreenElement === playSurfaceRef.current) {
        await document.exitFullscreen();
      } else {
        await playSurfaceRef.current.requestFullscreen();
      }
    } catch {
      setStatusMessage("Impossible de basculer en plein écran.");
    }
  }

  async function connectToRoom(
    endpoint: string,
    options?: {
      action: Exclude<PendingAction, "guest" | "upgrade" | "signin" | "passkeyAdd" | "passkeySignIn" | "signOut" | null>;
      body?: Record<string, unknown>;
      pendingMessage: string;
    }
  ) {
    if (!sessionUser) {
      setStatusMessage("Crée d’abord une session invitée ou connecte-toi.");
      return;
    }

    try {
      setPendingAction(options?.action ?? "public");
      setStatusMessage(options?.pendingMessage ?? "Préparation de l’entrée en partie…");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: options?.body ? JSON.stringify(options.body) : undefined
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
      const room = await client.consumeSeatReservation(toLegacySeatReservation(payload.reservation, payload.wsEndpoint) as never);

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
          setStatusMessage("Mot accepté, continue.");
        }
      });

      room.onMessage<MatchSummary>("match:summary", (summary) => {
        startTransition(() => {
          setMatchSummary(summary);
        });
      });

      room.onError((code, message) => {
        setStatusMessage(`Erreur de salon ${code}: ${message ?? "inconnue"}`);
      });

      room.onLeave((code, reason) => {
        setStatusMessage(`Connexion au salon fermée (${code})${reason ? `: ${reason}` : ""}`);
      });

      room.send("request_sync");
      window.dispatchEvent(new Event("motus-metrics-refresh"));
      setStatusMessage(payload.roomCode ? `Salon privé ${payload.roomCode} prêt.` : "Match public lancé.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Connexion impossible.");
    } finally {
      setPendingAction(null);
    }
  }

  async function continueAsGuest() {
    setPendingAction("guest");
    setStatusMessage("Création de la session invitée…");
    const result = await authClient.signIn.anonymous();

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Impossible de créer la session invitée.");
      return;
    }

    await refetch();
    window.dispatchEvent(new Event("motus-metrics-refresh"));
    setPendingAction(null);
    setStatusMessage("Session invitée prête.");
  }

  async function signUpEmail() {
    setPendingAction("upgrade");
    setStatusMessage("Création ou liaison du compte…");
    const result = await authClient.signUp.email({
      name: nameInput || sessionUser?.name || "Joueur Motus",
      email: emailInput,
      password: passwordInput
    });

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Création de compte impossible.");
      return;
    }

    await refetch();
    window.dispatchEvent(new Event("motus-metrics-refresh"));
    setPendingAction(null);
    setStatusMessage("Compte créé et lié à la session en cours.");
    setPasswordInput("");
  }

  async function signInEmail() {
    setPendingAction("signin");
    setStatusMessage("Connexion au compte…");
    const result = await authClient.signIn.email({
      email: emailInput,
      password: passwordInput
    });

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Connexion impossible.");
      return;
    }

    await refetch();
    window.dispatchEvent(new Event("motus-metrics-refresh"));
    setPendingAction(null);
    setStatusMessage("Connexion réussie.");
    setPasswordInput("");
  }

  async function addPasskey() {
    setPendingAction("passkeyAdd");
    setStatusMessage("Enregistrement de la passkey…");
    const result = await authClient.passkey.addPasskey({
      name: "Appareil principal"
    });

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Impossible d’ajouter une passkey.");
      return;
    }

    setPendingAction(null);
    setStatusMessage("Passkey enregistrée.");
  }

  async function signInWithPasskey() {
    setPendingAction("passkeySignIn");
    setStatusMessage("Connexion par passkey…");
    const result = await authClient.signIn.passkey();

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Connexion passkey impossible.");
      return;
    }

    await refetch();
    window.dispatchEvent(new Event("motus-metrics-refresh"));
    setPendingAction(null);
    setStatusMessage("Connexion par passkey réussie.");
  }

  async function signOut() {
    setPendingAction("signOut");
    const result = await authClient.signOut();

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(result.error.message ?? "Déconnexion impossible.");
      return;
    }

    await refetch();
    window.dispatchEvent(new Event("motus-metrics-refresh"));
    setPendingAction(null);
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

      const normalized = composeGuessDraft(guess, liveBoardSnapshot, blockedLetters, knownLetterLimits);

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
      setStatusMessage(`"${letter}" est éliminée pour cette manche.`);
      return;
    }

      setGuess((current) => extractEditableGuess(`${current}${letter}`, liveBoardSnapshot, blockedLetters, knownLetterLimits));
  }

  function removeLetter() {
    setGuess((current) => current.slice(0, -1));
  }

  function getKeyboardTone(letter: string): KeyboardLetterState {
    return keyboardStates.get(letter) ?? "unused";
  }

  function getKeyboardButtonClass(tone: KeyboardLetterState): string {
    return clsx(
      compactTouchRound
        ? "relative flex h-9 w-full items-center justify-center overflow-hidden rounded-lg border px-0.5 text-[0.95rem] transition"
        : compactDesktopKeyboard
          ? "relative flex h-9 w-full items-center justify-center overflow-hidden rounded-lg border px-0.5 text-[0.92rem] transition sm:h-10 sm:text-[1rem]"
        : "relative flex h-11 w-full items-center justify-center overflow-hidden rounded-xl border px-1 text-base sm:h-12 sm:rounded-2xl sm:px-2 sm:text-lg transition",
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

    const iconTone =
      tone === "hint" || tone === "correct" || tone === "present" || tone === "absent"
        ? tone
        : null;

    return (
      <span
        className={clsx(
          "pointer-events-none absolute z-10 flex items-center justify-center rounded-full border",
          compactDesktopKeyboard ? "right-1 top-1 h-4 w-4" : "right-1.5 top-1.5 h-4.5 w-4.5",
          iconTone === "correct" && "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "present" && "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "absent" && "border-white/10 bg-slate-950/45 text-slate-200",
          iconTone === "hint" && "border-cyan-950/12 bg-slate-950/12 text-slate-950"
        )}
      >
        <FeedbackToneIcon
          tone={iconTone as Exclude<WordTileTone, "idle" | "pending">}
          className={compactDesktopKeyboard ? "h-2.25 w-2.25" : "h-2.5 w-2.5"}
        />
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
    () => composeGuessDraft(guess, liveBoardSnapshot, blockedLetters, knownLetterLimits),
    [blockedLetters, liveBoardSnapshot, guess, knownLetterLimits]
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
  const remainingLettersLabel =
    editableSlotCount <= 0 ? "Mot prêt" : editableSlotCount === 1 ? "1 lettre à compléter" : `${editableSlotCount} lettres à compléter`;
  const keyboardToggleLabel = showDesktopKeyboard ? "Masquer le clavier visuel" : "Afficher le clavier visuel";
  const touchKeyboardToggleLabel = showTouchKeyboard ? "Masquer le clavier intégré" : "Clavier intégré";

  return (
    <div
      ref={playSurfaceRef}
      className={clsx(
        "flex min-h-0 flex-1 flex-col",
        isLiveRound && "h-full overflow-hidden",
        fullscreenActive && "fixed inset-0 z-[80] h-[100dvh] w-screen bg-[#040811]"
      )}
    >
      <GlassPanel
        className={clsx(
          "flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5 md:p-6",
          compactTouchRound && "p-2.5",
          fullscreenActive &&
            "rounded-none border-0 bg-[linear-gradient(180deg,rgba(9,16,30,0.98),rgba(3,7,16,1))] px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-none sm:p-4"
        )}
      >
        <div
          className={clsx(
            "flex-1 grid min-h-0 items-stretch gap-6 lg:gap-8",
            compactTouchRound && "gap-2.5",
            isInRoom ? "grid-cols-1" : "lg:grid-cols-[1.15fr_0.85fr]"
          )}
        >
          <div className={clsx("min-w-0 flex min-h-0 flex-col gap-6", compactTouchRound && "gap-2.5", isLiveRound && "overflow-hidden")}>
            {!isInRoom ? (
              <SectionHeader
                eyebrow="Jouer"
                title="Match public, salon privé, partie live"
                body="Tout se passe au même endroit: session, entrée en partie et manche en direct. Tu peux commencer en invité puis créer un compte sans perdre ton profil."
                action={
                  canToggleFullscreen ? (
                    <button className="button-secondary" type="button" onClick={() => void toggleFullscreen()} aria-pressed={fullscreenActive}>
                      {fullscreenActive ? "Quitter le plein écran" : "Plein écran"}
                    </button>
                  ) : undefined
                }
              />
            ) : null}

            {!sessionUser ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Invité express</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">Démarrer sans compte</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Une session locale se crée en un clic. Tu peux la convertir ensuite en compte, sans perdre ton profil.
                  </p>
                  <button className="button-primary mt-5 w-full" type="button" onClick={continueAsGuest} disabled={isPending || isBusy || pendingAction !== null}>
                    {pendingAction === "guest" ? "Création de la session…" : "Continuer en invité"}
                  </button>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Connexion</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">Passkey ou email</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Reprends ta progression avec une passkey déjà enregistrée ou ton email et ton mot de passe.
                  </p>
                  <button
                    className="button-secondary mt-5 w-full"
                    type="button"
                    onClick={signInWithPasskey}
                    disabled={isPending || isBusy || pendingAction !== null}
                  >
                    {pendingAction === "passkeySignIn" ? "Connexion passkey…" : "Se connecter avec une passkey"}
                  </button>
                  <div className="mt-5 space-y-3">
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-slate-500">
                      <span className="h-px flex-1 bg-white/8" />
                      <span>ou</span>
                      <span className="h-px flex-1 bg-white/8" />
                    </div>
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
                      <button className="button-primary w-full" type="submit" disabled={!emailInput || !passwordInput || isSubmittingSession}>
                        {pendingAction === "signin" ? "Connexion…" : "Se connecter"}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ) : !roomSnapshot ? (
              <div className="grid gap-5 xl:grid-cols-[1fr_0.92fr]">
                <div className="min-w-0 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <button
                      className="button-primary relative z-10 w-full"
                      type="button"
                      onClick={() =>
                        void connectToRoom("/api/game/public-ticket", {
                          action: "public",
                          pendingMessage: "Recherche d’un match public…"
                        })
                      }
                      disabled={isBusy || isConnectingToRoom}
                    >
                      {publicTicketPending ? "Recherche en cours…" : "Rejoindre le matchmaking"}
                    </button>
                    <button
                      className="button-secondary relative z-10 w-full"
                      type="button"
                      onClick={() =>
                        void connectToRoom("/api/game/private-ticket", {
                          action: "private",
                          pendingMessage: "Création du salon privé…"
                        })
                      }
                      disabled={isBusy || isConnectingToRoom}
                    >
                      {privateTicketPending ? "Création du salon…" : "Créer un salon privé"}
                    </button>
                  </div>

                  <p className="text-sm leading-6 text-slate-400" aria-live="polite">
                    {isConnectingToRoom ? "Connexion en cours. L’écran basculera dès que le salon répond." : "Public pour aller vite, privé pour inviter par code."}
                  </p>

                  <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                    <p className="eyebrow">Rejoindre avec un code</p>
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
                        type="button"
                        onClick={() =>
                          void connectToRoom("/api/game/private-join", {
                            action: "privateJoin",
                            body: { roomCode: privateCode },
                            pendingMessage: `Connexion au salon ${privateCode.trim().toUpperCase()}…`
                          })
                        }
                        disabled={!privateCode || isBusy || isConnectingToRoom}
                      >
                        {privateJoinPending ? "Connexion…" : "Entrer dans le salon"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="eyebrow">Compte</p>
                      <h3 className="mt-2 break-words font-display text-2xl text-white sm:text-3xl">{sessionUser.name}</h3>
                      <p className="mt-2 break-all text-sm text-slate-300">{sessionUser.email}</p>
                    </div>
                    <MetricBadge label="Type" value={sessionUser.isAnonymous ? "Invité" : "Compte"} />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button className="button-secondary flex-1" type="button" onClick={() => setAuthMode("upgrade")}>
                      Créer un compte
                    </button>
                    <button className="button-secondary flex-1" type="button" onClick={() => setAuthMode("signin")}>
                      Me connecter
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
                        <button className="button-primary w-full" type="submit" disabled={!emailInput || !passwordInput || isSubmittingSession}>
                          {pendingAction === "upgrade" ? "Création…" : "Créer ou lier mon compte"}
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
                        <button className="button-primary w-full" type="submit" disabled={!emailInput || !passwordInput || isSubmittingSession}>
                          {pendingAction === "signin" ? "Connexion…" : "Se connecter"}
                        </button>
                      </form>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button className="button-secondary w-full" type="button" onClick={addPasskey} disabled={pendingAction === "passkeyAdd"}>
                        {pendingAction === "passkeyAdd" ? "Ajout…" : "Ajouter une passkey"}
                      </button>
                      <button className="button-danger w-full" type="button" onClick={signOut} disabled={pendingAction === "signOut"}>
                        {pendingAction === "signOut" ? "Déconnexion…" : "Se déconnecter"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={clsx(
                  "grid min-h-0 gap-5",
                  lockedSidebarToDesktop
                    ? "xl:grid-cols-[minmax(0,1fr)_18.5rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]"
                    : "xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_23rem]"
                )}
              >
                <div className={clsx("min-w-0", isLiveRound ? `flex min-h-0 flex-col overflow-hidden ${compactLiveRound ? "gap-3" : "gap-4"}` : "space-y-5")}>
                  <div className={clsx("flex flex-wrap gap-2", compactTouchRound && "gap-1", compactDesktopRound && "gap-1.5")}>
                    {!compactLiveRound ? <MetricBadge label="Phase" value={phaseBadgeValue} /> : null}
                    <MetricBadge label="Temps" value={timeValue} tone={roomPhase === "round" ? "danger" : "default"} />
                    {!compactLiveRound ? <MetricBadge label="Salon" value={roomSnapshot.roomCode ?? "Public"} /> : null}
                    {!compactLiveRound ? <MetricBadge label="Mode" value={modeLabel} tone="good" /> : null}
                    {isLiveRound ? <MetricBadge label="Score" value={localPlayer?.score ?? 0} /> : null}
                    {isLiveRound && liveBoardSnapshot ? <MetricBadge label="Essais" value={liveBoardSnapshot.attemptsRemaining} tone="good" /> : null}
                    {canToggleFullscreen ? (
                      <button
                        className={clsx("button-secondary min-h-10 px-3 py-2 text-sm", compactLiveRound && "min-h-9 px-2.5 py-1.5 text-xs")}
                        type="button"
                        onClick={() => void toggleFullscreen()}
                      >
                        {fullscreenActive ? "Quitter le plein écran" : "Plein écran"}
                      </button>
                    ) : null}
                    {isLiveRound && !prefersTouchInput ? (
                      <button
                        className={clsx("button-secondary min-h-10 px-3 py-2 text-sm", compactDesktopKeyboard && "min-h-9 px-2.5 py-1.5 text-xs")}
                        type="button"
                        onClick={() => setShowDesktopKeyboard((current) => !current)}
                        aria-pressed={showDesktopKeyboard}
                      >
                        {keyboardToggleLabel}
                      </button>
                    ) : null}
                  </div>

                    <div
                      className={clsx(
                      "min-h-0 rounded-[30px] border border-white/8 bg-slate-950/72",
                      compactTouchRound ? "relative p-2.5" : compactLiveRound ? "p-3" : "p-4 sm:p-5",
                      isLiveRound && "flex h-full flex-col overflow-hidden"
                    )}
                  >
                    <div
                      className={clsx(
                        "flex flex-col gap-3",
                        compactTouchRound && "mb-2 gap-1.5",
                        !isLiveRound && "mb-5 sm:flex-row sm:items-start sm:justify-between",
                        isLiveRound && !compactLiveRound && "mb-3 sm:flex-row sm:items-start sm:justify-between",
                        compactDesktopRound && "mb-2"
                      )}
                    >
                      <div className="min-w-0">
                        {!compactLiveRound ? <p className="eyebrow">Partie en cours</p> : null}
                        <h3
                          className={clsx(
                            "font-display text-white",
                            compactTouchRound ? "text-[1.15rem]" : "mt-2 text-3xl sm:text-4xl",
                            compactDesktopRound && "mt-0 text-[2rem]",
                            isLiveRound && !compactLiveRound && "text-2xl sm:text-3xl"
                          )}
                        >
                          {roundTitle}
                        </h3>
                        {!compactLiveRound ? (
                          <p className={clsx("mt-2 max-w-2xl text-sm leading-6 text-slate-300", isLiveRound && "sm:max-w-xl")}>{roundSubtitle}</p>
                        ) : null}
                        {showInlineStatusMessage ? (
                          <p className={clsx("mt-3 text-sm text-slate-400 md:hidden", compactTouchRound && "hidden")} aria-live="polite">
                            {statusMessage}
                          </p>
                        ) : null}
                      </div>

                      {!isLiveRound ? (
                        <div className="grid gap-2 sm:min-w-40">
                          <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                            <p className="eyebrow">Score</p>
                            <p className="number-tabular text-3xl font-semibold text-white">{localPlayer?.score ?? 0}</p>
                          </div>
                          {liveBoardSnapshot ? (
                            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                              <p className="eyebrow">Essais restants</p>
                              <p className="number-tabular text-2xl font-semibold text-white">{liveBoardSnapshot.attemptsRemaining}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {showRoundReveal ? (
                      showCompactReveal ? (
                        <div className="mx-auto mb-3 w-full max-w-[34rem] rounded-[20px] border border-amber-300/20 bg-amber-300/10 px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="eyebrow">Réponse manche {currentRoundNumber}</p>
                            <span
                              className={clsx(
                                "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                                liveBoardSnapshot?.roundSolved
                                  ? "border-lime-300/30 bg-lime-300/10 text-lime-50"
                                  : "border-amber-200/30 bg-amber-200/10 text-amber-50"
                              )}
                            >
                              {liveBoardSnapshot?.roundSolved ? `+${liveBoardSnapshot.roundScore} pts` : "Non trouvé"}
                            </span>
                          </div>
                          <p className="mt-2 break-words font-display text-[1.6rem] uppercase tracking-[0.16em] text-white sm:text-[1.85rem]">
                            {revealWord}
                          </p>
                        </div>
                      ) : (
                        <div className="mx-auto mb-5 w-full max-w-[34rem] rounded-[24px] border border-amber-300/20 bg-amber-300/10 px-4 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="eyebrow">Réponse de la manche {currentRoundNumber}</p>
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
                      )
                    ) : null}

                    <div
                      className={clsx(
                        isLiveRound && "min-h-0 flex-1",
                        compactTouchRound && "flex items-start justify-center pt-1 pb-[7.5rem]",
                        compactTouchRound && showVirtualKeyboard && "pb-[16.75rem]"
                      )}
                    >
                      {boardIsStale ? (
                        <div className="mx-auto w-full max-w-[34rem] rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                          <p className="eyebrow">Synchronisation</p>
                          <p className="mt-2 font-display text-2xl text-white">Chargement du nouveau mot…</p>
                          <p className="mt-2 text-sm text-slate-400">L’ancienne grille reste masquée jusqu’à la bonne manche.</p>
                        </div>
                      ) : liveBoardSnapshot ? (
                        <div
                          data-play-grid
                          className={clsx("mx-auto w-full", compactTouchRound ? "space-y-1" : denseDesktopBoard ? "space-y-1.5 sm:space-y-2" : "space-y-2 sm:space-y-3")}
                          style={{ maxWidth: liveBoardMaxWidth }}
                        >
                          {displayRows.map((row, rowIndex) => (
                            <div
                              key={rowIndex}
                              className={clsx("grid", compactTouchRound ? "gap-1" : denseDesktopBoard ? "gap-1.5 sm:gap-2" : "gap-2 sm:gap-3")}
                              style={{ gridTemplateColumns: `repeat(${liveBoardSnapshot.wordLength}, minmax(0, 1fr))` }}
                            >
                              {row.map((cell, columnIndex) => (
                                <WordTile
                                  key={`${rowIndex}-${columnIndex}`}
                                  letter={cell.letter}
                                  state={cell.state}
                                  hint={cell.hint}
                                  compact={compactTouchRound}
                                  dense={denseDesktopBoard}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mx-auto w-full max-w-[34rem] rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                          <p className="eyebrow">Avant la manche</p>
                          <p className="mt-2 text-sm text-slate-300">La grille arrive avec le démarrage de la manche.</p>
                        </div>
                      )}
                    </div>

                    {isLiveRound && (
                      <div
                        className={clsx(
                          "z-30 mx-auto w-full",
                          compactTouchRound
                            ? "pointer-events-none absolute inset-x-2 bottom-2"
                            : prefersTouchInput
                              ? "sticky bottom-0 pb-[calc(env(safe-area-inset-bottom)+0.25rem)]"
                              : "mt-auto pt-2"
                        )}
                        style={{ maxWidth: liveDockMaxWidth }}
                      >
                        <div
                          className={clsx(
                            "overflow-hidden rounded-[24px] border",
                            prefersTouchInput
                              ? compactTouchRound
                                ? "pointer-events-auto border-white/10 bg-slate-950/96 p-2.5 shadow-[0_-10px_44px_rgba(0,0,0,0.5)] backdrop-blur"
                                : "border-white/10 bg-slate-950/96 p-3 shadow-[0_-10px_44px_rgba(0,0,0,0.5)] backdrop-blur"
                              : compactDesktopKeyboard
                                ? "border-white/8 bg-white/[0.03] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.22)]"
                                : "border-white/8 bg-white/[0.03] p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]"
                          )}
                        >
                          <div className={clsx("flex flex-col", compactDockLayout ? "gap-2" : "gap-3")}>
                            {!compactTouchRound ? (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="eyebrow">Tentative</p>
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-200">
                                      {remainingLettersLabel}
                                    </span>
                                    {!prefersTouchInput ? (
                                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] text-cyan-50">
                                        Clavier physique actif
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {!prefersTouchInput && !compactDesktopRound && !compactDesktopKeyboard ? <p className="text-right text-xs leading-5 text-slate-400">{statusMessage}</p> : null}
                              </div>
                            ) : null}

                            <div className={clsx("flex flex-wrap gap-2", (!prefersTouchInput || compactTouchRound) && "hidden")}>
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

                            <form
                              className={clsx(compactDockLayout ? "space-y-2" : "space-y-3")}
                              onSubmit={(event) => {
                                event.preventDefault();
                                submitGuess();
                              }}
                            >
                              <input
                                ref={guessInputRef}
                                className={clsx("input-shell", compactDockLayout && "px-3 py-2.5 text-sm")}
                                value={guess}
                                onFocus={() => {
                                  setIsInputFocused(true);
                                  if (prefersTouchInput) {
                                    setShowTouchKeyboard(false);
                                  }
                                }}
                                onBlur={() => setIsInputFocused(false)}
                                onChange={(event) => setGuess(extractEditableGuess(event.target.value, liveBoardSnapshot, blockedLetters, knownLetterLimits))}
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
                                      setStatusMessage(`"${typedLetter}" est éliminée pour cette manche.`);
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
                                readOnly={compactTouchRound && showTouchKeyboard}
                                spellCheck={false}
                              />
                              <div className={clsx("grid grid-cols-3 gap-2", compactDockLayout && "gap-1.5")}>
                                <button
                                  className={clsx("button-secondary w-full", compactDockLayout && "min-h-9 px-2 py-1.5 text-sm")}
                                  type="button"
                                  onClick={() => roomRef.current?.send("use_clue")}
                                  disabled={!(liveBoardSnapshot?.canUseClue ?? false)}
                                >
                                  Indice
                                </button>
                                <button className={clsx("button-primary w-full", compactDockLayout && "min-h-9 px-2 py-1.5 text-sm")} type="submit">
                                  Valider
                                </button>
                                <button
                                  className={clsx("button-secondary w-full", compactDockLayout && "min-h-9 px-2 py-1.5 text-sm")}
                                  type="button"
                                  onClick={removeLetter}
                                >
                                  Effacer
                                </button>
                              </div>
                            </form>

                            {compactTouchRound && fullscreenActive ? (
                              <button
                                className={clsx(
                                  "self-start rounded-full border px-3 py-1 text-[11px] text-slate-100 transition",
                                  showTouchKeyboard ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-white/[0.04]"
                                )}
                                type="button"
                                onClick={() => {
                                  if (showTouchKeyboard) {
                                    setShowTouchKeyboard(false);
                                    guessInputRef.current?.focus({ preventScroll: true });
                                    return;
                                  }

                                  guessInputRef.current?.blur();
                                  setShowTouchKeyboard(true);
                                }}
                                aria-pressed={showTouchKeyboard}
                              >
                                {touchKeyboardToggleLabel}
                              </button>
                            ) : null}

                            {showVirtualKeyboard ? (
                              <div
                                className={clsx(
                                  compactTouchRound || compactDesktopKeyboard ? "space-y-1 overflow-hidden" : "space-y-1.5 overflow-hidden sm:space-y-2",
                                  isInputFocused && prefersTouchInput && "hidden"
                                )}
                              >
                                {keyboardRows.map((row) => (
                                  <div
                                    key={row}
                                    className={clsx("mx-auto grid", compactTouchRound || compactDesktopKeyboard ? "gap-1" : "gap-1.5 sm:gap-2")}
                                    style={{
                                      gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                                      maxWidth: virtualKeyboardMaxWidth
                                    }}
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
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}

                    {roomPhase === "lobby" || roomPhase === "queue" || roomPhase === "countdown" ? (
                      <div className="mt-5 flex flex-wrap gap-3">
                        {roomSnapshot.roomKind === "private" && (
                          <>
                            <button className="button-secondary w-full sm:w-auto" onClick={() => roomRef.current?.send("set_ready")}>
                              {localPlayer?.status === "ready" ? "Retirer mon prêt" : "Je suis prêt"}
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

                <div
                  className={clsx(
                    "grid min-w-0 gap-5",
                    compactTouchRound && "hidden",
                    lockedSidebarToDesktop ? "hidden xl:grid xl:self-start xl:sticky xl:top-4 xl:grid-cols-1 xl:gap-4" : "lg:grid-cols-2 xl:sticky xl:top-6 xl:grid-cols-1"
                  )}
                >
                  <div className={clsx("hidden rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5 xl:block", isLiveRound && "xl:hidden")}>
                    <p className="eyebrow">Session</p>
                    <h3 className="mt-3 break-words font-display text-2xl text-white sm:text-3xl">{sessionUser?.name}</h3>
                    <p className="mt-2 break-all text-sm text-slate-300">{sessionUser?.email}</p>
                    <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                      <MetricBadge label="Type" value={sessionUser?.isAnonymous ? "Invité" : "Compte"} />
                      <MetricBadge label="Salon" value="Connecté" tone="good" />
                    </div>
                  </div>

                  {isLiveRound ? (
                    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="eyebrow">Lettres éliminées</p>
                          <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">Ardoise totale</h3>
                        </div>
                        <MetricBadge label="Total" value={eliminatedLetters.length} tone="danger" />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {eliminatedLetters.length ? (
                          eliminatedLetters.map((letter) => (
                            <span
                              key={letter}
                              className="rounded-full border border-slate-400/25 bg-slate-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-100"
                            >
                              {letter}
                            </span>
                          ))
                        ) : (
                          <p className="text-sm leading-6 text-slate-400">Aucune lettre totalement éliminée.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={clsx("hidden rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5 xl:block", compactLobbySidebar && "xl:hidden")}>
                      <p className="eyebrow">Repères</p>
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
                  )}

                  <div
                    className={clsx(
                      "rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5",
                      lockedSidebarToDesktop && "flex max-h-[calc(100dvh-15rem)] flex-col overflow-hidden"
                    )}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow">Classement</p>
                        <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">{lockedSidebarToDesktop ? "Positions" : "Classement live"}</h3>
                      </div>
                      <MetricBadge label="Joueurs" value={deferredSnapshot?.players.length ?? roomSnapshot.players.length} />
                    </div>

                    <div className={clsx("mt-5 space-y-3", lockedSidebarToDesktop && "flex-1 overflow-y-auto pr-1")}>
                      {(deferredSnapshot?.players ?? roomSnapshot.players).map((player, index) => (
                        <div
                          key={player.userId}
                          className={clsx(
                            "rounded-[22px] border px-4 py-3 transition",
                            lockedSidebarToDesktop && "px-3 py-2.5",
                            player.userId === sessionUser?.id ? "border-cyan-300/35 bg-cyan-300/10" : "border-white/8 bg-white/[0.03]"
                          )}
                        >
                          <div className={clsx("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", lockedSidebarToDesktop && "gap-2")}>
                            <div className="min-w-0 flex items-center gap-3">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-sm text-white">
                                #{index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="break-words font-medium text-white">{player.name}</p>
                                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{getPlayerStatusLabel(player.status)}</p>
                              </div>
                            </div>
                            <span className="number-tabular text-sm text-slate-200">{player.score} pts</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={clsx("rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5", isLiveRound && "hidden")}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow">État du match</p>
                        <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">{matchInfoTitle}</h3>
                      </div>
                      <MetricBadge label="Statut" value={localStatusLabel} />
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-200" aria-live="polite">
                      {matchInfoBody}
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      {matchInfoStats.map((item) => (
                        <div key={item.label} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                          <p className="eyebrow">{item.label}</p>
                          <p className="mt-2 text-lg font-medium text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    {showSystemStatusNote ? (
                      <div className="mt-5 rounded-[20px] border border-white/8 bg-slate-950/40 px-4 py-3">
                        <p className="eyebrow">Retour système</p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{statusMessage}</p>
                      </div>
                    ) : null}

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
                          <button
                            className="button-primary w-full"
                            type="button"
                            onClick={() =>
                              void connectToRoom("/api/game/public-ticket", {
                                action: "public",
                                pendingMessage: "Recherche d’un match public…"
                              })
                            }
                          >
                            Relancer en public
                          </button>
                          <button
                            className="button-secondary w-full"
                            type="button"
                            onClick={() =>
                              void connectToRoom("/api/game/private-ticket", {
                                action: "private",
                                pendingMessage: "Création du salon privé…"
                              })
                            }
                          >
                            Nouveau salon privé
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
                <p className="eyebrow">Session</p>
                <h3 className="mt-3 break-words font-display text-2xl text-white sm:text-3xl">
                  {sessionUser?.name ?? "Aucune session"}
                </h3>
                <p className="mt-2 break-all text-sm text-slate-300">{sessionUser?.email ?? "Passe par invité ou email."}</p>
                <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                  <MetricBadge label="Type" value={sessionUser?.isAnonymous ? "Invité" : sessionUser ? "Compte" : "Aucune"} />
                  <MetricBadge label="Partie" value={roomSnapshot ? "Connecté" : "En attente"} tone={roomSnapshot ? "good" : "default"} />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                <p className="eyebrow">Règles</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  <li>1. Tout le monde reçoit le même mot, avec des lettres déjà révélées verrouillées en cyan.</li>
                  <li>2. Vert = bonne lettre au bon endroit, ambre = bonne lettre ailleurs, ardoise = lettre absente.</li>
                  <li>3. Le score récompense la résolution, la vitesse et la propreté, puis la finale départage le top 4.</li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}
