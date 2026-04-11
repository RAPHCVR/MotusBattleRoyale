"use client";

import {
  type FormEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import clsx from "clsx";
import { Client, type Room } from "colyseus.js";

import {
  FeedbackToneIcon,
  GlassPanel,
  MetricBadge,
  SectionHeader,
  WordTile,
  type WordTileTone,
} from "@motus/ui";
import type {
  BoardSnapshot,
  GuessResult,
  MatchSummary,
  PlayerSummary,
  RoomSnapshot,
  SeatReservation,
  TicketBundle,
} from "@motus/protocol";

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
  getLockedLetters,
} from "@/components/play-shell-helpers";

const keyboardRows = ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"];
const feedbackLegend = [
  {
    key: "hint",
    title: "Lettre verrouillée",
    body: "Cyan. La lettre est déjà révélée et reste posée automatiquement.",
    letter: "A",
    hint: true,
    tone: "hint" as const,
  },
  {
    key: "correct",
    title: "Bien placée",
    body: "Vert. Bonne lettre, bonne case.",
    letter: "A",
    state: "correct" as const,
    tone: "correct" as const,
  },
  {
    key: "present",
    title: "Présente",
    body: "Ambre. Bonne lettre, mais mauvaise case.",
    letter: "A",
    state: "present" as const,
    tone: "present" as const,
  },
  {
    key: "absent",
    title: "Éliminée",
    body: "Ardoise. Lettre absente du mot quand l'état est confirmé.",
    letter: "A",
    state: "absent" as const,
    tone: "absent" as const,
  },
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
    "fermée",
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

function toLegacySeatReservation(
  reservation: SeatReservation,
  wsEndpoint: string,
) {
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
      publicAddress,
    },
    reconnectionToken: reservation.reconnectionToken,
    devMode: reservation.devMode,
    protocol: "ws",
  };
}

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenDocument() {
  return document as FullscreenDocument;
}

function getCurrentFullscreenElement() {
  const fullscreenDocument = getFullscreenDocument();
  return (
    fullscreenDocument.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    null
  );
}

function supportsNativeFullscreen(element: HTMLElement | null) {
  if (!element) {
    return false;
  }

  const fullscreenDocument = getFullscreenDocument();
  const fullscreenElement = element as FullscreenElement;

  return Boolean(
    (fullscreenDocument.fullscreenEnabled ||
      fullscreenDocument.webkitFullscreenEnabled) &&
    (fullscreenElement.requestFullscreen ||
      fullscreenElement.webkitRequestFullscreen),
  );
}

async function requestNativeFullscreen(element: HTMLElement) {
  const fullscreenElement = element as FullscreenElement;

  if (fullscreenElement.requestFullscreen) {
    await fullscreenElement.requestFullscreen({ navigationUI: "hide" });
    return;
  }

  if (fullscreenElement.webkitRequestFullscreen) {
    await fullscreenElement.webkitRequestFullscreen();
    return;
  }

  throw new Error("Native fullscreen unavailable.");
}

async function exitNativeFullscreen() {
  const fullscreenDocument = getFullscreenDocument();

  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }

  if (fullscreenDocument.webkitExitFullscreen) {
    await fullscreenDocument.webkitExitFullscreen();
  }
}

export function PlayShell() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [isBusy, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string>(
    "Prêt pour la première partie.",
  );
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [boardSnapshot, setBoardSnapshot] = useState<BoardSnapshot | null>(
    null,
  );
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
  const [viewportInsetBottom, setViewportInsetBottom] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  const liveDockRef = useRef<HTMLDivElement | null>(null);
  const previousBoardRef = useRef<BoardSnapshot | null>(null);
  const previousPlayerStatusRef = useRef<string | null>(null);
  const playSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [prefersTouchInput, setPrefersTouchInput] = useState(false);
  const [showDesktopKeyboard, setShowDesktopKeyboard] = useState(false);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [liveDockHeight, setLiveDockHeight] = useState(0);

  const deferredSnapshot = useDeferredValue(roomSnapshot);
  const sessionUser = session?.user as
    | { id: string; name: string; email: string; isAnonymous?: boolean }
    | undefined;
  const roomPhase = deferredSnapshot?.phase ?? null;
  const roomPlayers = deferredSnapshot?.players ?? roomSnapshot?.players ?? [];
  const localPlayer = useMemo(
    () =>
      roomPlayers.find((player) => player.userId === sessionUser?.id) ?? null,
    [roomPlayers, sessionUser?.id],
  );
  const isInRoom = Boolean(roomSnapshot);
  const timeValue =
    roomPhase === "round"
      ? formatRemaining(deferredSnapshot?.roundEndsAt, now)
      : formatRemaining(deferredSnapshot?.countdownEndsAt, now);
  const boardIsStale = Boolean(
    boardSnapshot &&
    roomPhase === "round" &&
    deferredSnapshot &&
    boardSnapshot.roundIndex !== deferredSnapshot.currentRoundIndex,
  );
  const liveBoardSnapshot = boardIsStale ? null : boardSnapshot;
  const keyboardStates = useMemo(
    () => buildKeyboardLetterStates(liveBoardSnapshot),
    [liveBoardSnapshot],
  );
  const blockedLetters = useMemo(
    () => getBlockedLetters(liveBoardSnapshot),
    [liveBoardSnapshot],
  );
  const knownLetterLimits = useMemo(
    () => getKnownLetterLimits(liveBoardSnapshot),
    [liveBoardSnapshot],
  );
  const eliminatedLetters = useMemo(
    () =>
      Array.from(blockedLetters).sort((left, right) =>
        left.localeCompare(right, "fr"),
      ),
    [blockedLetters],
  );
  const currentRoundNumber = deferredSnapshot
    ? deferredSnapshot.currentRoundIndex + 1
    : 0;
  const finalistsCount = deferredSnapshot?.finalistsCount ?? 0;
  const activePlayerCount =
    deferredSnapshot?.activePlayerCount ?? roomPlayers.length;
  const roomPlayerCount = roomPlayers.length;
  const connectedPlayerCount = roomPlayers.filter(
    (player) => player.connected,
  ).length;
  const readyPlayerCount = roomPlayers.filter(
    (player) => player.status === "ready",
  ).length;
  const isPreRoundPhase =
    roomPhase === "queue" || roomPhase === "lobby" || roomPhase === "countdown";
  const showWaitingRoster = isPreRoundPhase;
  const showSidebarLeaderboard = Boolean(roomSnapshot) && !showWaitingRoster;
  const localStatus = localPlayer?.status ?? null;
  const localStatusLabel = localStatus
    ? getPlayerStatusLabel(localStatus)
    : "Hors partie";
  const revealWord = liveBoardSnapshot?.solution;
  const showRoundReveal = Boolean(
    liveBoardSnapshot?.roundResolved && revealWord,
  );
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
  const isLiveRound = Boolean(
    liveBoardSnapshot &&
    roomPhase === "round" &&
    localPlayer?.status === "playing",
  );
  const phaseBadgeValue = getPhaseBadgeValue(roomPhase);
  const fullscreenActive = isFullscreen || isPseudoFullscreen;
  const hideWaitingRosterPanel =
    showWaitingRoster && prefersTouchInput && fullscreenActive;
  const shortTouchViewport =
    prefersTouchInput && viewportHeight > 0 && viewportHeight <= 760;
  const compactTouchRoomShell =
    prefersTouchInput &&
    isInRoom &&
    !isLiveRound &&
    (fullscreenActive || (viewportHeight > 0 && viewportHeight <= 860));
  const showCompactReveal =
    showRoundReveal &&
    (fullscreenActive ||
      prefersTouchInput ||
      (viewportHeight > 0 && viewportHeight <= 880));
  const showVirtualKeyboard = prefersTouchInput
    ? fullscreenActive && showTouchKeyboard
    : showDesktopKeyboard;
  const isSubmittingSession =
    pendingAction === "guest" ||
    pendingAction === "upgrade" ||
    pendingAction === "signin" ||
    pendingAction === "passkeySignIn";
  const isConnectingToRoom =
    pendingAction === "public" ||
    pendingAction === "private" ||
    pendingAction === "privateJoin";
  const publicTicketPending = pendingAction === "public";
  const privateTicketPending = pendingAction === "private";
  const privateJoinPending = pendingAction === "privateJoin";
  const lockedSidebarToDesktop = isLiveRound && !prefersTouchInput;
  const compactTouchRound = isLiveRound && prefersTouchInput;
  const compactTouchKeyboardVisible =
    compactTouchRound && fullscreenActive && showTouchKeyboard;
  const compactDesktopRound =
    isLiveRound &&
    !prefersTouchInput &&
    viewportHeight > 0 &&
    viewportHeight <= 860;
  const desktopVisualKeyboardOpen =
    isLiveRound && !prefersTouchInput && showVirtualKeyboard;
  const compactDesktopKeyboard =
    desktopVisualKeyboardOpen &&
    (fullscreenActive ||
      compactDesktopRound ||
      (viewportHeight > 0 && viewportHeight <= 920));
  const fullscreenDesktopKeyboardLayout =
    compactDesktopKeyboard && fullscreenActive;
  const desktopKeyboardExpandsPage =
    desktopVisualKeyboardOpen && !fullscreenActive;
  const compactDockLayout = compactTouchRound || compactDesktopKeyboard;
  const denseDesktopBoard =
    isLiveRound && !prefersTouchInput && compactDesktopRound;
  const compactLiveRound =
    compactTouchRound ||
    compactDesktopRound ||
    (compactDesktopKeyboard && fullscreenActive);
  const canToggleFullscreen = isFullscreenSupported || prefersTouchInput;
  const nativeKeyboardInset = prefersTouchInput ? viewportInsetBottom : 0;
  const nativeKeyboardActive =
    isLiveRound &&
    prefersTouchInput &&
    isInputFocused &&
    !showTouchKeyboard &&
    nativeKeyboardInset > 0;
  const dockKeyboardInset = fullscreenActive ? 0 : nativeKeyboardInset;
  const mobilePinnedDock = isLiveRound && prefersTouchInput;
  const compactMetricStrip =
    prefersTouchInput || compactLiveRound || lockedSidebarToDesktop;
  const hideCompactTouchHeader =
    compactTouchRound && (nativeKeyboardActive || compactTouchKeyboardVisible);
  const showCompactMobileEliminatedLetters =
    isLiveRound &&
    prefersTouchInput &&
    !showTouchKeyboard &&
    !nativeKeyboardActive;
  const roomCodeLabel = roomSnapshot?.roomCode ?? "Public";
  const roomStatusLabel =
    roomSnapshot?.roomKind === "private" && roomPhase !== "queue"
      ? `${readyPlayerCount}/${roomPlayerCount || 1} prêts`
      : `${connectedPlayerCount || roomPlayerCount} connectés`;
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
  const matchInfoBody = matchSummary
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
          { label: "Joueurs", value: roomPlayerCount },
          { label: "Statut", value: localStatusLabel },
        ]
      : [
          { label: "Encore en course", value: activePlayerCount },
          {
            label: "Finalistes",
            value: finalistsCount > 0 ? finalistsCount : "À venir",
          },
          { label: "Statut", value: localStatusLabel },
        ];
  const showSystemStatusNote =
    isOperationalStatusMessage(statusMessage) &&
    statusMessage !== matchInfoBody;
  const showInlineStatusMessage = isLiveRound || showSystemStatusNote;
  const liveBoardMaxWidth = isLiveRound
    ? prefersTouchInput
      ? fullscreenActive
        ? shortTouchViewport
          ? "min(100%, 17.25rem)"
          : "min(100%, 18.5rem)"
        : shortTouchViewport
          ? "min(100%, 17rem)"
          : "min(100%, 18rem)"
      : compactDesktopKeyboard
        ? fullscreenActive
          ? "min(100%, 27rem)"
          : "min(100%, 27rem)"
        : compactDesktopRound
          ? "max(17rem, min(20rem, calc(100dvh - 23rem)))"
          : "max(20rem, min(27rem, calc(100dvh - 24rem)))"
    : compactTouchRoomShell
      ? shortTouchViewport
        ? "min(100%, 16.5rem)"
        : "min(100%, 18rem)"
      : prefersTouchInput && isInRoom
        ? "min(100%, 19rem)"
        : "34rem";
  const liveDockMaxWidth = isLiveRound
    ? prefersTouchInput
      ? fullscreenActive
        ? shortTouchViewport
          ? "min(100%, 19rem)"
          : "min(100%, 20rem)"
        : "min(100%, 18.5rem)"
      : compactDesktopKeyboard
        ? fullscreenActive
          ? "min(100%, 36rem)"
          : "min(100%, 31rem)"
        : compactDesktopRound
          ? "max(18rem, min(24rem, calc(100dvh - 19rem)))"
          : "max(22rem, min(31rem, calc(100dvh - 21rem)))"
    : "34rem";
  const virtualKeyboardMaxWidth = compactTouchKeyboardVisible
    ? shortTouchViewport
      ? "min(100%, 19rem)"
      : "min(100%, 20rem)"
    : compactTouchRound
      ? shortTouchViewport
        ? "min(100%, 19rem)"
        : "min(100%, 20rem)"
      : compactDesktopKeyboard
        ? fullscreenActive
          ? "min(100%, 36rem)"
          : "min(100%, 31rem)"
        : "34rem";
  const mobilePinnedDockSpacing = mobilePinnedDock
    ? liveDockHeight + dockKeyboardInset + 12
    : 0;
  const mobilePinnedDockOffset = mobilePinnedDock ? dockKeyboardInset : 0;
  const fullscreenSurfaceStyle = fullscreenActive
    ? {
        height:
          prefersTouchInput && viewportHeight > 0
            ? `${viewportHeight}px`
            : "100dvh",
        maxHeight:
          prefersTouchInput && viewportHeight > 0
            ? `${viewportHeight}px`
            : "100dvh",
      }
    : undefined;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");

    const syncInputMode = () => {
      const prefersTouch = mediaQuery.matches || window.innerWidth < 768;
      const visualViewport = window.visualViewport;
      const visualViewportHeight = Math.round(
        visualViewport?.height ?? window.innerHeight,
      );
      const visualViewportOffsetTop = Math.max(
        0,
        Math.round(visualViewport?.offsetTop ?? 0),
      );
      const visualViewportInsetBottom = Math.max(
        0,
        window.innerHeight - visualViewportHeight - visualViewportOffsetTop,
      );

      setPrefersTouchInput(prefersTouch);
      setViewportHeight(visualViewportHeight);
      setViewportInsetBottom(visualViewportInsetBottom);

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
      window.visualViewport?.removeEventListener(
        "resize",
        handleViewportChange,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        handleViewportChange,
      );
    };
  }, []);

  useEffect(() => {
    const liveDockElement = liveDockRef.current;

    if (!liveDockElement || !isLiveRound) {
      setLiveDockHeight(0);
      return;
    }

    const syncLiveDockHeight = () => {
      setLiveDockHeight(
        Math.ceil(liveDockElement.getBoundingClientRect().height),
      );
    };

    syncLiveDockHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncLiveDockHeight();
    });

    observer.observe(liveDockElement);

    return () => {
      observer.disconnect();
    };
  }, [isLiveRound, mobilePinnedDock, showVirtualKeyboard]);

  useEffect(() => {
    const syncFullscreenSupport = () => {
      setIsFullscreenSupported(
        supportsNativeFullscreen(playSurfaceRef.current),
      );
    };

    const handleFullscreenChange = () => {
      const fullscreenElement = getCurrentFullscreenElement();
      const nextFullscreen = Boolean(
        playSurfaceRef.current && fullscreenElement === playSurfaceRef.current,
      );

      if (nextFullscreen) {
        setIsPseudoFullscreen(false);
      }

      setIsFullscreen(nextFullscreen);
    };

    const handleFullscreenError = () => {
      setStatusMessage("Le plein écran n’est pas disponible sur cet appareil.");
    };

    syncFullscreenSupport();
    window.addEventListener("resize", syncFullscreenSupport);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener(
      "webkitfullscreenchange",
      handleFullscreenChange as EventListener,
    );
    document.addEventListener("fullscreenerror", handleFullscreenError);

    return () => {
      window.removeEventListener("resize", syncFullscreenSupport);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange as EventListener,
      );
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
      previousBoard.revealedIndexes.join(",") !==
        boardSnapshot.revealedIndexes.join(",") ||
      previousBoard.hintLetters.join("") !== boardSnapshot.hintLetters.join("");

    if (roundChanged) {
      setGuess("");
    } else if (lockSignatureChanged && previousBoard) {
      const previousBlockedLetters = getBlockedLetters(previousBoard);
      const previousKnownLetterLimits = getKnownLetterLimits(previousBoard);

      setGuess((current) =>
        extractEditableGuess(
          composeGuessDraft(
            current,
            previousBoard,
            previousBlockedLetters,
            previousKnownLetterLimits,
          ),
          boardSnapshot,
          blockedLetters,
          knownLetterLimits,
        ),
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
        setStatusMessage(
          getEliminationStatusCopy(currentRoundNumber, finalistsCount),
        );
      } else if (nextStatus === "spectating") {
        setStatusMessage("Tu observes cette phase. La saisie est désactivée.");
      }
    }

    previousPlayerStatusRef.current = nextStatus;
  }, [currentRoundNumber, finalistsCount, localPlayer?.status]);

  useEffect(() => {
    if (
      liveBoardSnapshot &&
      roomPhase === "round" &&
      localPlayer?.status === "playing"
    ) {
      if (
        window.matchMedia("(pointer: coarse)").matches ||
        window.innerWidth < 768
      ) {
        return;
      }

      guessInputRef.current?.focus({ preventScroll: true });
    }
  }, [liveBoardSnapshot?.roundIndex, localPlayer?.status, roomPhase]);

  useEffect(() => {
    if (
      !prefersTouchInput ||
      !isInputFocused ||
      showTouchKeyboard ||
      fullscreenActive
    ) {
      return;
    }

    const target = guessInputRef.current;

    if (!target) {
      return;
    }

    const syncFocusedInput = () => {
      target.scrollIntoView({
        block: "end",
        inline: "nearest",
      });
    };

    const frame = window.requestAnimationFrame(syncFocusedInput);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fullscreenActive, isInputFocused, prefersTouchInput, showTouchKeyboard]);

  async function toggleFullscreen() {
    const playSurface = playSurfaceRef.current;

    if (!playSurface) {
      return;
    }

    const nativeFullscreenSupported = supportsNativeFullscreen(playSurface);

    try {
      if (isFullscreen) {
        await exitNativeFullscreen();
        return;
      }

      if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
        return;
      }

      if (nativeFullscreenSupported) {
        await requestNativeFullscreen(playSurface);
        return;
      }
    } catch {
      if (prefersTouchInput) {
        setIsPseudoFullscreen(true);
        setStatusMessage(
          "Plein écran natif refusé, bascule sur le mode immersif local.",
        );
        return;
      }

      setStatusMessage("Impossible de basculer en plein écran.");
      return;
    }

    setIsPseudoFullscreen((current) => !current);
  }

  async function connectToRoom(
    endpoint: string,
    options?: {
      action: Exclude<
        PendingAction,
        | "guest"
        | "upgrade"
        | "signin"
        | "passkeyAdd"
        | "passkeySignIn"
        | "signOut"
        | null
      >;
      body?: Record<string, unknown>;
      pendingMessage: string;
    },
  ) {
    if (!sessionUser) {
      setStatusMessage("Crée d’abord une session invitée ou connecte-toi.");
      return;
    }

    try {
      setPendingAction(options?.action ?? "public");
      setStatusMessage(
        options?.pendingMessage ?? "Préparation de l’entrée en partie…",
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      const payload = (await response.json()) as TicketBundle & {
        error?: string;
      };

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
      const room = await client.consumeSeatReservation(
        toLegacySeatReservation(
          payload.reservation,
          payload.wsEndpoint,
        ) as never,
      );

      clientRef.current = client;
      roomRef.current = room;

      room.onMessage<RoomSnapshot>("phase:update", (snapshot) => {
        startTransition(() => {
          setBoardSnapshot((current) => {
            if (!current) {
              return current;
            }

            if (
              snapshot.phase === "round" &&
              current.roundIndex !== snapshot.currentRoundIndex
            ) {
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
          setStatusMessage(
            `Indice débloqué sur la case ${result.clueRevealedIndex + 1}.`,
          );
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
        setStatusMessage(
          `Connexion au salon fermée (${code})${reason ? `: ${reason}` : ""}`,
        );
      });

      room.send("request_sync");
      window.dispatchEvent(new Event("motus-metrics-refresh"));
      setStatusMessage(
        payload.roomCode
          ? `Salon privé ${payload.roomCode} prêt.`
          : "Match public lancé.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Connexion impossible.",
      );
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
      setStatusMessage(
        result.error.message ?? "Impossible de créer la session invitée.",
      );
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
      password: passwordInput,
    });

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(
        result.error.message ?? "Création de compte impossible.",
      );
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
      password: passwordInput,
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
      name: "Appareil principal",
    });

    if (result.error) {
      setPendingAction(null);
      setStatusMessage(
        result.error.message ?? "Impossible d’ajouter une passkey.",
      );
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

    const normalized = composeGuessDraft(
      guess,
      liveBoardSnapshot,
      blockedLetters,
      knownLetterLimits,
    );

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

    setGuess((current) =>
      extractEditableGuess(
        `${current}${letter}`,
        liveBoardSnapshot,
        blockedLetters,
        knownLetterLimits,
      ),
    );
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
      tone === "correct" &&
        "border-lime-200/85 bg-lime-300 text-slate-950 shadow-[0_12px_22px_rgba(178,255,82,0.16)]",
      tone === "present" &&
        "border-amber-200/85 bg-amber-300 text-slate-950 shadow-[0_10px_18px_rgba(255,190,85,0.14)]",
      tone === "hint" && "border-cyan-200/70 bg-cyan-300 text-slate-950",
      tone === "absent" &&
        "cursor-not-allowed border-slate-700/90 bg-slate-800 text-slate-300",
      tone === "unused" &&
        "border-white/10 bg-white/[0.04] text-white hover:border-cyan-300/40 hover:bg-cyan-300/10 focus-visible:border-cyan-300/45",
    );
  }

  function renderKeyboardToneDecor(tone: KeyboardLetterState) {
    if (tone === "unused") {
      return null;
    }

    const iconTone =
      tone === "hint" ||
      tone === "correct" ||
      tone === "present" ||
      tone === "absent"
        ? tone
        : null;

    return (
      <span
        className={clsx(
          "pointer-events-none absolute z-10 flex items-center justify-center rounded-full border",
          compactDesktopKeyboard
            ? "right-1 top-1 h-4 w-4"
            : "right-1.5 top-1.5 h-4.5 w-4.5",
          iconTone === "correct" &&
            "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "present" &&
            "border-slate-950/12 bg-slate-950/10 text-slate-950",
          iconTone === "absent" &&
            "border-white/10 bg-slate-950/45 text-slate-200",
          iconTone === "hint" &&
            "border-cyan-950/12 bg-slate-950/12 text-slate-950",
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
  const lockedLetters = useMemo(
    () => getLockedLetters(liveBoardSnapshot),
    [liveBoardSnapshot],
  );
  const guessDraft = useMemo(
    () =>
      composeGuessDraft(
        guess,
        liveBoardSnapshot,
        blockedLetters,
        knownLetterLimits,
      ),
    [blockedLetters, liveBoardSnapshot, guess, knownLetterLimits],
  );
  const editableSlotCount = useMemo(
    () => getEditableSlotCount(liveBoardSnapshot),
    [liveBoardSnapshot],
  );
  const displayRows = useMemo(() => {
    if (!liveBoardSnapshot) {
      return [];
    }

    const rows: Array<
      Array<{
        letter: string;
        state?: "correct" | "present" | "absent" | "pending";
        hint?: boolean;
      }>
    > = [];

    for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
      const existing = liveRows[rowIndex];

      if (existing) {
        rows.push(
          existing.tiles.map((tile, index) => ({
            letter: existing.guess[index] ?? "",
            state: tile,
            hint: liveBoardSnapshot.revealedIndexes.includes(index),
          })),
        );
        continue;
      }

      const isCurrentRow =
        rowIndex === liveRows.length &&
        roomPhase === "round" &&
        localPlayer?.status === "playing";

      rows.push(
        Array.from({ length: liveBoardSnapshot.wordLength }, (_, index) => {
          const typedLetter = isCurrentRow ? (guessDraft[index] ?? "") : "";
          const hintLetter = !typedLetter ? (lockedLetters[index] ?? "") : "";
          const isLockedCell = Boolean(lockedLetters[index]);

          return {
            letter: typedLetter || hintLetter,
            state: typedLetter && !isLockedCell ? "pending" : undefined,
            hint: Boolean(hintLetter),
          };
        }),
      );
    }

    return rows;
  }, [
    guessDraft,
    liveBoardSnapshot,
    liveRows,
    localPlayer?.status,
    lockedLetters,
    roomPhase,
  ]);
  const remainingLettersLabel =
    editableSlotCount <= 0
      ? "Mot prêt"
      : editableSlotCount === 1
        ? "1 lettre à compléter"
        : `${editableSlotCount} lettres à compléter`;
  const keyboardToggleLabel = compactMetricStrip
    ? showDesktopKeyboard
      ? "Masquer clavier"
      : "Clavier"
    : showDesktopKeyboard
      ? "Masquer le clavier visuel"
      : "Afficher le clavier visuel";
  const touchKeyboardToggleLabel = showTouchKeyboard
    ? "Clavier système"
    : "Clavier intégré";
  const fullscreenButtonLabel =
    compactMetricStrip && fullscreenActive
      ? "Quitter"
      : fullscreenActive
        ? "Quitter le plein écran"
        : "Plein écran";

  return (
    <div
      ref={playSurfaceRef}
      className={clsx(
        desktopKeyboardExpandsPage
          ? "flex w-full flex-col"
          : "flex min-h-0 flex-1 flex-col",
        isLiveRound && !desktopKeyboardExpandsPage && "h-full overflow-hidden",
        fullscreenActive &&
          "fixed inset-x-0 top-0 z-[80] w-screen overflow-hidden bg-[#040811]",
      )}
      style={fullscreenSurfaceStyle}
    >
      <GlassPanel
        className={clsx(
          desktopKeyboardExpandsPage
            ? "flex flex-col overflow-visible p-4 sm:p-5 md:p-6"
            : "flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5 md:p-6",
          compactTouchRound && "p-2.5",
          fullscreenActive &&
            "rounded-none border-0 bg-[linear-gradient(180deg,rgba(9,16,30,0.98),rgba(3,7,16,1))] px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-none sm:p-4",
        )}
      >
        <div
          className={clsx(
            desktopKeyboardExpandsPage
              ? "grid items-stretch gap-6 lg:gap-8"
              : "flex-1 grid min-h-0 items-stretch gap-6 lg:gap-8",
            compactTouchRound && "gap-2.5",
            isInRoom ? "grid-cols-1" : "lg:grid-cols-[1.15fr_0.85fr]",
          )}
        >
          <div
            className={clsx(
              desktopKeyboardExpandsPage
                ? "min-w-0 flex flex-col gap-6"
                : "min-w-0 flex min-h-0 flex-col gap-6",
              compactTouchRound && "gap-2.5",
              isLiveRound && !desktopKeyboardExpandsPage && "overflow-hidden",
            )}
          >
            {!isInRoom ? (
              <SectionHeader
                eyebrow="Jouer"
                title="Match public, salon privé, partie live"
                body="Tout se passe au même endroit: session, entrée en partie et manche en direct. Tu peux commencer en invité puis créer un compte sans perdre ton profil."
                action={
                  canToggleFullscreen ? (
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void toggleFullscreen()}
                      aria-pressed={fullscreenActive}
                    >
                      {fullscreenActive
                        ? "Quitter le plein écran"
                        : "Plein écran"}
                    </button>
                  ) : undefined
                }
              />
            ) : null}

            {!sessionUser ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Invité express</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">
                    Démarrer sans compte
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Une session locale se crée en un clic. Tu peux la convertir
                    ensuite en compte, sans perdre ton profil.
                  </p>
                  <button
                    className="button-primary mt-5 w-full"
                    type="button"
                    onClick={continueAsGuest}
                    disabled={isPending || isBusy || pendingAction !== null}
                  >
                    {pendingAction === "guest"
                      ? "Création de la session…"
                      : "Continuer en invité"}
                  </button>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <p className="eyebrow">Connexion</p>
                  <h3 className="mt-3 font-display text-2xl text-white sm:text-3xl">
                    Passkey ou email
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Reprends ta progression avec une passkey déjà enregistrée ou
                    ton email et ton mot de passe.
                  </p>
                  <button
                    className="button-secondary mt-5 w-full"
                    type="button"
                    onClick={signInWithPasskey}
                    disabled={isPending || isBusy || pendingAction !== null}
                  >
                    {pendingAction === "passkeySignIn"
                      ? "Connexion passkey…"
                      : "Se connecter avec une passkey"}
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
                        onChange={(event) =>
                          setPasswordInput(event.target.value)
                        }
                        autoComplete="current-password"
                      />
                      <button
                        className="button-primary w-full"
                        type="submit"
                        disabled={
                          !emailInput || !passwordInput || isSubmittingSession
                        }
                      >
                        {pendingAction === "signin"
                          ? "Connexion…"
                          : "Se connecter"}
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
                          pendingMessage: "Recherche d’un match public…",
                        })
                      }
                      disabled={isBusy || isConnectingToRoom}
                    >
                      {publicTicketPending
                        ? "Recherche en cours…"
                        : "Rejoindre le matchmaking"}
                    </button>
                    <button
                      className="button-secondary relative z-10 w-full"
                      type="button"
                      onClick={() =>
                        void connectToRoom("/api/game/private-ticket", {
                          action: "private",
                          pendingMessage: "Création du salon privé…",
                        })
                      }
                      disabled={isBusy || isConnectingToRoom}
                    >
                      {privateTicketPending
                        ? "Création du salon…"
                        : "Créer un salon privé"}
                    </button>
                  </div>

                  <p
                    className="text-sm leading-6 text-slate-400"
                    aria-live="polite"
                  >
                    {isConnectingToRoom
                      ? "Connexion en cours. L’écran basculera dès que le salon répond."
                      : "Public pour aller vite, privé pour inviter par code."}
                  </p>

                  <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                    <p className="eyebrow">Rejoindre avec un code</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        className="input-shell"
                        placeholder="AB12CD"
                        value={privateCode}
                        onChange={(event) =>
                          setPrivateCode(event.target.value.toUpperCase())
                        }
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
                            pendingMessage: `Connexion au salon ${privateCode.trim().toUpperCase()}…`,
                          })
                        }
                        disabled={!privateCode || isBusy || isConnectingToRoom}
                      >
                        {privateJoinPending
                          ? "Connexion…"
                          : "Entrer dans le salon"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 rounded-[26px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="eyebrow">Compte</p>
                      <h3 className="mt-2 break-words font-display text-2xl text-white sm:text-3xl">
                        {sessionUser.name}
                      </h3>
                      <p className="mt-2 break-all text-sm text-slate-300">
                        {sessionUser.email}
                      </p>
                    </div>
                    <MetricBadge
                      label="Type"
                      value={sessionUser.isAnonymous ? "Invité" : "Compte"}
                    />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                      className="button-secondary flex-1"
                      type="button"
                      onClick={() => setAuthMode("upgrade")}
                    >
                      Créer un compte
                    </button>
                    <button
                      className="button-secondary flex-1"
                      type="button"
                      onClick={() => setAuthMode("signin")}
                    >
                      Me connecter
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    {authMode === "upgrade" ? (
                      <form
                        className="space-y-3"
                        onSubmit={handleUpgradeSubmit}
                      >
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
                          onChange={(event) =>
                            setEmailInput(event.target.value)
                          }
                          autoComplete="email"
                        />
                        <input
                          className="input-shell"
                          placeholder="Mot de passe"
                          type="password"
                          value={passwordInput}
                          onChange={(event) =>
                            setPasswordInput(event.target.value)
                          }
                          autoComplete="new-password"
                        />
                        <button
                          className="button-primary w-full"
                          type="submit"
                          disabled={
                            !emailInput || !passwordInput || isSubmittingSession
                          }
                        >
                          {pendingAction === "upgrade"
                            ? "Création…"
                            : "Créer ou lier mon compte"}
                        </button>
                      </form>
                    ) : (
                      <form className="space-y-3" onSubmit={handleSignInSubmit}>
                        <input
                          className="input-shell"
                          placeholder="email@domaine.com"
                          type="email"
                          value={emailInput}
                          onChange={(event) =>
                            setEmailInput(event.target.value)
                          }
                          autoComplete="email"
                        />
                        <input
                          className="input-shell"
                          placeholder="Mot de passe"
                          type="password"
                          value={passwordInput}
                          onChange={(event) =>
                            setPasswordInput(event.target.value)
                          }
                          autoComplete="current-password"
                        />
                        <button
                          className="button-primary w-full"
                          type="submit"
                          disabled={
                            !emailInput || !passwordInput || isSubmittingSession
                          }
                        >
                          {pendingAction === "signin"
                            ? "Connexion…"
                            : "Se connecter"}
                        </button>
                      </form>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        className="button-secondary w-full"
                        type="button"
                        onClick={addPasskey}
                        disabled={pendingAction === "passkeyAdd"}
                      >
                        {pendingAction === "passkeyAdd"
                          ? "Ajout…"
                          : "Ajouter une passkey"}
                      </button>
                      <button
                        className="button-danger w-full"
                        type="button"
                        onClick={signOut}
                        disabled={pendingAction === "signOut"}
                      >
                        {pendingAction === "signOut"
                          ? "Déconnexion…"
                          : "Se déconnecter"}
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
                    ? "lg:grid-cols-[minmax(0,1fr)_16.5rem] xl:grid-cols-[minmax(0,1fr)_17.5rem] 2xl:grid-cols-[minmax(0,1fr)_18.5rem]"
                    : "xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_23rem]",
                )}
              >
                <div
                  className={clsx(
                    "min-w-0",
                    isLiveRound
                      ? `flex min-h-0 flex-col ${desktopKeyboardExpandsPage ? "overflow-visible" : "overflow-hidden"} ${compactLiveRound ? "gap-3" : "gap-4"}`
                      : "space-y-5",
                  )}
                >
                  <div
                    className={clsx(
                      "flex flex-wrap gap-2",
                      compactTouchRound && "gap-1",
                      compactDesktopRound && "gap-1.5",
                    )}
                  >
                    {!compactLiveRound && !isPreRoundPhase ? (
                      <MetricBadge
                        label="Phase"
                        value={phaseBadgeValue}
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {roomPhase === "round" || roomPhase === "countdown" ? (
                      <MetricBadge
                        label="Temps"
                        value={timeValue}
                        tone={roomPhase === "round" ? "danger" : "default"}
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {!compactLiveRound &&
                    !lockedSidebarToDesktop &&
                    isInRoom ? (
                      <MetricBadge
                        label="Salon"
                        value={roomSnapshot.roomCode ?? "Public"}
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {!isLiveRound && isInRoom ? (
                      <MetricBadge
                        label={
                          roomSnapshot.roomKind === "private" &&
                          roomPhase !== "queue"
                            ? "Prêts"
                            : "Joueurs"
                        }
                        value={
                          roomSnapshot.roomKind === "private" &&
                          roomPhase !== "queue"
                            ? `${readyPlayerCount}/${roomPlayerCount}`
                            : roomPlayerCount
                        }
                        tone={
                          roomSnapshot.roomKind === "private" &&
                          readyPlayerCount >= Math.max(2, roomPlayerCount)
                            ? "good"
                            : "default"
                        }
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {isLiveRound ? (
                      <MetricBadge
                        label="Score"
                        value={localPlayer?.score ?? 0}
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {isLiveRound && liveBoardSnapshot ? (
                      <MetricBadge
                        label="Essais"
                        value={liveBoardSnapshot.attemptsRemaining}
                        tone="good"
                        compact={compactMetricStrip}
                      />
                    ) : null}
                    {canToggleFullscreen ? (
                      <button
                        className={clsx(
                          "button-secondary min-h-10 px-3 py-2 text-sm",
                          compactMetricStrip && "min-h-9 px-2.5 py-1.5 text-xs",
                        )}
                        type="button"
                        onClick={() => void toggleFullscreen()}
                      >
                        {fullscreenButtonLabel}
                      </button>
                    ) : null}
                    {isLiveRound && !prefersTouchInput ? (
                      <button
                        className={clsx(
                          "button-secondary min-h-10 px-3 py-2 text-sm",
                          compactMetricStrip && "min-h-9 px-2.5 py-1.5 text-xs",
                        )}
                        type="button"
                        onClick={() =>
                          setShowDesktopKeyboard((current) => !current)
                        }
                        aria-pressed={showDesktopKeyboard}
                      >
                        {keyboardToggleLabel}
                      </button>
                    ) : null}
                  </div>

                  <div
                    className={clsx(
                      "min-h-0 rounded-[30px] border border-white/8 bg-slate-950/72",
                      compactTouchRound
                        ? "relative p-2.5"
                        : compactLiveRound
                          ? "p-3"
                          : "p-4 sm:p-5",
                      isLiveRound &&
                        fullscreenDesktopKeyboardLayout &&
                        "flex-1",
                      isLiveRound &&
                        (desktopKeyboardExpandsPage
                          ? "flex flex-col"
                          : "flex h-full flex-col overflow-hidden"),
                    )}
                  >
                    <div
                      className={clsx(
                        "flex flex-col gap-3",
                        compactTouchRound && "mb-2 gap-1.5",
                        hideCompactTouchHeader && "mb-1 gap-1",
                        !isLiveRound &&
                          "mb-5 sm:flex-row sm:items-start sm:justify-between",
                        isLiveRound &&
                          !compactLiveRound &&
                          "mb-3 sm:flex-row sm:items-start sm:justify-between",
                        compactDesktopRound && "mb-2",
                      )}
                    >
                      <div className="min-w-0">
                        {!compactLiveRound && !hideCompactTouchHeader ? (
                          <p className="eyebrow">Partie en cours</p>
                        ) : null}
                        {!hideCompactTouchHeader ? (
                          <h3
                            className={clsx(
                              "font-display text-white",
                              compactTouchRound
                                ? "text-[1.15rem]"
                                : "mt-2 text-3xl sm:text-4xl",
                              compactDesktopRound && "mt-0 text-[2rem]",
                              isLiveRound &&
                                !compactLiveRound &&
                                "text-2xl sm:text-3xl",
                            )}
                          >
                            {roundTitle}
                          </h3>
                        ) : null}
                        {!compactLiveRound ? (
                          <p
                            className={clsx(
                              "mt-2 max-w-2xl text-sm leading-6 text-slate-300",
                              isLiveRound && "sm:max-w-xl",
                            )}
                          >
                            {roundSubtitle}
                          </p>
                        ) : null}
                        {showInlineStatusMessage ? (
                          <p
                            className={clsx(
                              "mt-3 text-sm text-slate-400 md:hidden",
                              compactTouchRound && "hidden",
                            )}
                            aria-live="polite"
                          >
                            {statusMessage}
                          </p>
                        ) : null}
                        {!isLiveRound && isInRoom ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <InlineMetaPill
                              label="Salon"
                              value={roomCodeLabel}
                            />
                            <InlineMetaPill
                              label="Joueurs"
                              value={String(roomPlayerCount)}
                            />
                            <InlineMetaPill
                              label={
                                roomSnapshot.roomKind === "private"
                                  ? "Prêts"
                                  : "Connectés"
                              }
                              value={roomStatusLabel}
                              tone={
                                roomSnapshot.roomKind === "private" &&
                                readyPlayerCount >= Math.max(2, roomPlayerCount)
                                  ? "good"
                                  : "default"
                              }
                            />
                            {showRoundReveal && revealWord ? (
                              <InlineMetaPill
                                label="Réponse"
                                value={revealWord}
                                tone="danger"
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {hideWaitingRosterPanel ? (
                          <p className="mt-4 text-sm leading-6 text-slate-300">
                            {roomPlayerCount > 1
                              ? `${roomPlayerCount} joueurs ont rejoint le salon. La liste détaillée reste masquée en plein écran mobile pour garder la zone principale lisible.`
                              : "Tu es seul dans le salon pour l’instant. L’écran garde uniquement les compteurs utiles tant que personne d’autre n’a rejoint."}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {showRoundReveal ? (
                      showCompactReveal ? (
                        <div className="mx-auto mb-3 w-full max-w-[34rem] rounded-[20px] border border-amber-300/20 bg-amber-300/10 px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="eyebrow">
                              Réponse manche {currentRoundNumber}
                            </p>
                            <span
                              className={clsx(
                                "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                                liveBoardSnapshot?.roundSolved
                                  ? "border-lime-300/30 bg-lime-300/10 text-lime-50"
                                  : "border-amber-200/30 bg-amber-200/10 text-amber-50",
                              )}
                            >
                              {liveBoardSnapshot?.roundSolved
                                ? `+${liveBoardSnapshot.roundScore} pts`
                                : "Non trouvé"}
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
                              <p className="eyebrow">
                                Réponse de la manche {currentRoundNumber}
                              </p>
                              <p className="mt-2 break-words font-display text-3xl uppercase tracking-[0.18em] text-white sm:text-4xl">
                                {revealWord}
                              </p>
                            </div>
                            <MetricBadge
                              label="Bilan"
                              value={
                                liveBoardSnapshot?.roundSolved
                                  ? "Trouvé"
                                  : "Raté"
                              }
                              tone={
                                liveBoardSnapshot?.roundSolved
                                  ? "good"
                                  : "danger"
                              }
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
                        isLiveRound &&
                          (desktopKeyboardExpandsPage
                            ? "pt-1"
                            : fullscreenDesktopKeyboardLayout
                              ? "min-h-0 flex flex-1 items-center justify-center pb-3"
                              : "min-h-0 flex-1"),
                        compactTouchRound &&
                          (nativeKeyboardActive || compactTouchKeyboardVisible
                            ? "flex items-start justify-center overflow-y-auto overscroll-contain pt-1 pb-2"
                            : "flex items-center justify-center py-2"),
                      )}
                      style={
                        compactTouchRound
                          ? { paddingBottom: mobilePinnedDockSpacing }
                          : undefined
                      }
                    >
                      {boardIsStale ? (
                        <div className="mx-auto w-full max-w-[34rem] rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-8 text-center">
                          <p className="eyebrow">Synchronisation</p>
                          <p className="mt-2 font-display text-2xl text-white">
                            Chargement du nouveau mot…
                          </p>
                          <p className="mt-2 text-sm text-slate-400">
                            L’ancienne grille reste masquée jusqu’à la bonne
                            manche.
                          </p>
                        </div>
                      ) : liveBoardSnapshot ? (
                        <div
                          data-play-grid
                          className={clsx(
                            "mx-auto w-full",
                            compactTouchRound
                              ? nativeKeyboardActive ||
                                compactTouchKeyboardVisible
                                ? "space-y-0.5"
                                : "space-y-1"
                              : denseDesktopBoard
                                ? "space-y-1.5 sm:space-y-2"
                                : "space-y-2 sm:space-y-3",
                          )}
                          style={{ maxWidth: liveBoardMaxWidth }}
                        >
                          {displayRows.map((row, rowIndex) => (
                            <div
                              key={rowIndex}
                              className={clsx(
                                "grid",
                                compactTouchRound
                                  ? nativeKeyboardActive ||
                                    compactTouchKeyboardVisible
                                    ? "gap-0.5"
                                    : "gap-1"
                                  : denseDesktopBoard
                                    ? "gap-1.5 sm:gap-2"
                                    : "gap-2 sm:gap-3",
                              )}
                              style={{
                                gridTemplateColumns: `repeat(${liveBoardSnapshot.wordLength}, minmax(0, 1fr))`,
                              }}
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
                          <p className="mt-2 text-sm text-slate-300">
                            La grille arrive avec le démarrage de la manche.
                          </p>
                        </div>
                      )}
                    </div>

                    {isLiveRound && (
                      <div
                        ref={liveDockRef}
                        className={clsx(
                          "z-30 mx-auto w-full",
                          compactTouchRound
                            ? "pointer-events-none absolute inset-x-2"
                            : prefersTouchInput
                              ? "sticky bottom-0 pb-[calc(env(safe-area-inset-bottom)+0.25rem)]"
                              : desktopKeyboardExpandsPage
                                ? "mt-4"
                                : "mt-auto pt-2",
                        )}
                        style={{
                          maxWidth: liveDockMaxWidth,
                          bottom: compactTouchRound
                            ? `calc(${mobilePinnedDockOffset}px + 0.5rem)`
                            : undefined,
                        }}
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
                                : "border-white/8 bg-white/[0.03] p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]",
                          )}
                        >
                          <div
                            className={clsx(
                              "flex flex-col",
                              compactDockLayout ? "gap-2" : "gap-3",
                            )}
                          >
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
                                {!prefersTouchInput &&
                                !compactDesktopRound &&
                                !compactDesktopKeyboard ? (
                                  <p className="text-right text-xs leading-5 text-slate-400">
                                    {statusMessage}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            <div
                              className={clsx(
                                "flex flex-wrap gap-2",
                                (!prefersTouchInput || compactTouchRound) &&
                                  "hidden",
                              )}
                            >
                              {feedbackLegend.map((item) => (
                                <span
                                  key={item.key}
                                  className={clsx(
                                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium",
                                    item.tone === "correct" &&
                                      "border-lime-300/30 bg-lime-300/10 text-lime-50",
                                    item.tone === "present" &&
                                      "border-amber-300/30 bg-amber-300/10 text-amber-50",
                                    item.tone === "hint" &&
                                      "border-cyan-300/30 bg-cyan-300/10 text-cyan-50",
                                    item.tone === "absent" &&
                                      "border-slate-400/25 bg-slate-400/10 text-slate-200",
                                  )}
                                >
                                  <FeedbackToneIcon
                                    tone={item.tone}
                                    className="h-3 w-3"
                                  />
                                  {item.title}
                                </span>
                              ))}
                            </div>

                            {showCompactMobileEliminatedLetters ? (
                              <CompactEliminatedLettersStrip
                                letters={eliminatedLetters}
                              />
                            ) : null}

                            <form
                              className={clsx(
                                compactDockLayout ? "space-y-2" : "space-y-3",
                              )}
                              onSubmit={(event) => {
                                event.preventDefault();
                                submitGuess();
                              }}
                            >
                              <input
                                ref={guessInputRef}
                                className={clsx(
                                  "input-shell",
                                  compactDockLayout && "px-3 py-2.5 text-sm",
                                )}
                                value={guess}
                                onFocus={() => {
                                  setIsInputFocused(true);
                                  if (prefersTouchInput) {
                                    setShowTouchKeyboard(false);
                                  }
                                }}
                                onBlur={() => setIsInputFocused(false)}
                                onChange={(event) =>
                                  setGuess(
                                    extractEditableGuess(
                                      event.target.value,
                                      liveBoardSnapshot,
                                      blockedLetters,
                                      knownLetterLimits,
                                    ),
                                  )
                                }
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
                                      setStatusMessage(
                                        `"${typedLetter}" est éliminée pour cette manche.`,
                                      );
                                    }
                                  }
                                }}
                                placeholder={createEditableGuessPlaceholder(
                                  liveBoardSnapshot,
                                )}
                                aria-label="Saisir les lettres restantes"
                                autoCapitalize="characters"
                                autoComplete="off"
                                autoCorrect="off"
                                enterKeyHint="done"
                                inputMode="text"
                                maxLength={editableSlotCount}
                                readOnly={
                                  compactTouchRound && showTouchKeyboard
                                }
                                spellCheck={false}
                              />
                              <div
                                className={clsx(
                                  "grid grid-cols-3 gap-2",
                                  compactDockLayout && "gap-1.5",
                                )}
                              >
                                <button
                                  className={clsx(
                                    "button-secondary w-full",
                                    compactDockLayout &&
                                      "min-h-9 px-2 py-1.5 text-sm",
                                  )}
                                  type="button"
                                  onClick={() =>
                                    roomRef.current?.send("use_clue")
                                  }
                                  disabled={
                                    !(liveBoardSnapshot?.canUseClue ?? false)
                                  }
                                >
                                  Indice
                                </button>
                                <button
                                  className={clsx(
                                    "button-primary w-full",
                                    compactDockLayout &&
                                      "min-h-9 px-2 py-1.5 text-sm",
                                  )}
                                  type="submit"
                                >
                                  Valider
                                </button>
                                <button
                                  className={clsx(
                                    "button-secondary w-full",
                                    compactDockLayout &&
                                      "min-h-9 px-2 py-1.5 text-sm",
                                  )}
                                  type="button"
                                  onClick={removeLetter}
                                >
                                  Effacer
                                </button>
                              </div>
                            </form>

                            {compactTouchRound &&
                            fullscreenActive &&
                            !nativeKeyboardActive ? (
                              <button
                                className={clsx(
                                  "self-start rounded-full border px-3 py-1 text-[11px] text-slate-100 transition",
                                  showTouchKeyboard
                                    ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50"
                                    : "border-white/10 bg-white/[0.04]",
                                )}
                                type="button"
                                onClick={() => {
                                  if (showTouchKeyboard) {
                                    setShowTouchKeyboard(false);
                                    guessInputRef.current?.focus({
                                      preventScroll: true,
                                    });
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
                                  compactTouchRound || compactDesktopKeyboard
                                    ? "space-y-1 overflow-hidden"
                                    : "space-y-1.5 overflow-hidden sm:space-y-2",
                                  isInputFocused &&
                                    prefersTouchInput &&
                                    "hidden",
                                )}
                              >
                                {keyboardRows.map((row) => (
                                  <div
                                    key={row}
                                    className={clsx(
                                      "mx-auto grid",
                                      compactTouchRound ||
                                        compactDesktopKeyboard
                                        ? "gap-1"
                                        : "gap-1.5 sm:gap-2",
                                    )}
                                    style={{
                                      gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                                      maxWidth: virtualKeyboardMaxWidth,
                                    }}
                                  >
                                    {row.split("").map((letter) => {
                                      const tone = getKeyboardTone(letter);

                                      return (
                                        <button
                                          key={letter}
                                          aria-label={getKeyboardAriaLabel(
                                            letter,
                                          )}
                                          className={getKeyboardButtonClass(
                                            tone,
                                          )}
                                          disabled={blockedLetters.has(letter)}
                                          type="button"
                                          onClick={() => appendLetter(letter)}
                                        >
                                          {renderKeyboardToneDecor(tone)}
                                          <span className="relative z-10">
                                            {letter}
                                          </span>
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

                    {roomPhase === "lobby" ||
                    roomPhase === "queue" ||
                    roomPhase === "countdown" ? (
                      <div className="mt-5 flex flex-wrap gap-3">
                        {roomSnapshot.roomKind === "private" && (
                          <>
                            <button
                              className="button-secondary w-full sm:w-auto"
                              onClick={() => roomRef.current?.send("set_ready")}
                            >
                              {localPlayer?.status === "ready"
                                ? "Retirer mon prêt"
                                : "Je suis prêt"}
                            </button>
                            {sessionUser?.id === roomSnapshot.hostUserId && (
                              <button
                                className="button-primary w-full sm:w-auto"
                                onClick={() =>
                                  roomRef.current?.send("start_match")
                                }
                              >
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
                    lockedSidebarToDesktop
                      ? "hidden lg:grid lg:self-start lg:sticky lg:top-4 lg:max-h-[calc(100dvh-5.5rem)] lg:grid-cols-1 lg:gap-4 lg:overflow-y-auto lg:pr-1"
                      : "lg:grid-cols-2 xl:self-start xl:sticky xl:top-6 xl:max-h-[calc(100dvh-9rem)] xl:grid-cols-1 xl:overflow-y-auto xl:pr-1",
                  )}
                >
                  {isLiveRound ? (
                    <div
                      className={clsx(
                        "rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5",
                        lockedSidebarToDesktop && "hidden xl:block",
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="eyebrow">Lettres éliminées</p>
                          <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">
                            Ardoise totale
                          </h3>
                        </div>
                        <MetricBadge
                          label="Total"
                          value={eliminatedLetters.length}
                          tone="danger"
                        />
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
                          <p className="text-sm leading-6 text-slate-400">
                            Aucune lettre totalement éliminée.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {showWaitingRoster && !hideWaitingRosterPanel ? (
                    <PlayerListPanel
                      eyebrow={
                        roomSnapshot.roomKind === "private"
                          ? "Salon"
                          : "Matchmaking"
                      }
                      title={
                        roomPhase === "countdown"
                          ? "Joueurs prêts"
                          : roomSnapshot.roomKind === "private"
                            ? "Joueurs présents"
                            : "Joueurs en file"
                      }
                      metricLabel={
                        roomSnapshot.roomKind === "private" &&
                        roomPhase !== "queue"
                          ? "Prêts"
                          : "Connectés"
                      }
                      metricValue={
                        roomSnapshot.roomKind === "private" &&
                        roomPhase !== "queue"
                          ? `${readyPlayerCount}/${roomPlayerCount}`
                          : connectedPlayerCount
                      }
                      players={roomPlayers}
                      currentUserId={sessionUser?.id}
                      hostUserId={roomSnapshot.hostUserId}
                      variant="waiting"
                    />
                  ) : showSidebarLeaderboard ? (
                    <PlayerListPanel
                      eyebrow="Classement"
                      title={
                        roomPhase === "results"
                          ? "Classement final"
                          : lockedSidebarToDesktop
                            ? "Positions"
                            : "Classement live"
                      }
                      metricLabel="Joueurs"
                      metricValue={roomPlayerCount}
                      players={roomPlayers}
                      currentUserId={sessionUser?.id}
                      hostUserId={roomSnapshot.hostUserId}
                      variant="leaderboard"
                      compactMetric={lockedSidebarToDesktop}
                    />
                  ) : null}

                  {roomPhase === "results" ? (
                    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="eyebrow">État du match</p>
                          <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">
                            {matchInfoTitle}
                          </h3>
                        </div>
                        <MetricBadge label="Statut" value={localStatusLabel} />
                      </div>
                      <p
                        className="mt-4 text-sm leading-6 text-slate-200"
                        aria-live="polite"
                      >
                        {matchInfoBody}
                      </p>

                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        {matchInfoStats.map((item) => (
                          <div
                            key={item.label}
                            className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3"
                          >
                            <p className="eyebrow">{item.label}</p>
                            <p className="mt-2 text-lg font-medium text-white">
                              {item.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {showSystemStatusNote ? (
                        <div className="mt-5 rounded-[20px] border border-white/8 bg-slate-950/40 px-4 py-3">
                          <p className="eyebrow">Retour système</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {statusMessage}
                          </p>
                        </div>
                      ) : null}

                      {matchSummary ? (
                        <div className="mt-5 space-y-3">
                          <p className="eyebrow">Podium</p>
                          {matchSummary.players.slice(0, 3).map((player) => (
                            <div
                              key={player.userId}
                              className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-white">
                                  #{player.placement} {player.name}
                                </span>
                                <span className="number-tabular text-sm text-slate-200">
                                  {player.score}
                                </span>
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
                                  pendingMessage:
                                    "Recherche d’un match public…",
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
                                  pendingMessage: "Création du salon privé…",
                                })
                              }
                            >
                              Nouveau salon privé
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
                <p className="mt-2 break-all text-sm text-slate-300">
                  {sessionUser?.email ?? "Passe par invité ou email."}
                </p>
                <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                  <MetricBadge
                    label="Type"
                    value={
                      sessionUser?.isAnonymous
                        ? "Invité"
                        : sessionUser
                          ? "Compte"
                          : "Aucune"
                    }
                  />
                  <MetricBadge
                    label="Partie"
                    value={roomSnapshot ? "Connecté" : "En attente"}
                    tone={roomSnapshot ? "good" : "default"}
                  />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                <p className="eyebrow">Règles</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  <li>
                    1. Tout le monde reçoit le même mot, avec des lettres déjà
                    révélées verrouillées en cyan.
                  </li>
                  <li>
                    2. Vert = bonne lettre au bon endroit, ambre = bonne lettre
                    ailleurs, ardoise = lettre absente.
                  </li>
                  <li>
                    3. Le score récompense la résolution, la vitesse et la
                    propreté, puis la finale départage le top 4.
                  </li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function InlineMetaPill(props: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "default" | "good" | "danger";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium text-slate-100",
        props.tone === "good" &&
          "border-lime-300/30 bg-lime-300/10 text-lime-50",
        props.tone === "danger" &&
          "border-amber-300/30 bg-amber-300/10 text-amber-50",
        (!props.tone || props.tone === "default") &&
          "border-white/10 bg-white/[0.04]",
      )}
    >
      <span className="uppercase tracking-[0.18em] text-white/55">
        {props.label}
      </span>
      <strong className="font-semibold text-white">{props.value}</strong>
    </span>
  );
}

function CompactEliminatedLettersStrip(props: {
  readonly letters: readonly string[];
}) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Ardoise</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {props.letters.length
              ? "Lettres éliminées confirmées."
              : "Aucune lettre totalement éliminée pour l’instant."}
          </p>
        </div>
        <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-100">
          {props.letters.length}
        </span>
      </div>

      {props.letters.length ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {props.letters.map((letter) => (
            <span
              key={letter}
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-400/25 bg-slate-400/10 px-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-100"
            >
              {letter}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlayerListPanel(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly metricLabel: string;
  readonly metricValue: ReactNode;
  readonly players: readonly PlayerSummary[];
  readonly currentUserId?: string;
  readonly hostUserId?: string;
  readonly variant: "waiting" | "leaderboard";
  readonly compactMetric?: boolean;
}) {
  return (
    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{props.eyebrow}</p>
          <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">
            {props.title}
          </h3>
        </div>
        <MetricBadge
          label={props.metricLabel}
          value={props.metricValue}
          compact={props.compactMetric}
          tone={props.variant === "waiting" ? "good" : "default"}
        />
      </div>

      <div className="mt-5 space-y-3">
        {props.players.length ? (
          props.players.map((player, index) =>
            props.variant === "waiting" ? (
              <WaitingPlayerCard
                key={player.userId}
                player={player}
                isCurrentUser={player.userId === props.currentUserId}
                isHost={player.userId === props.hostUserId}
              />
            ) : (
              <LeaderboardPlayerCard
                key={player.userId}
                player={player}
                placement={index + 1}
                isCurrentUser={player.userId === props.currentUserId}
              />
            ),
          )
        ) : (
          <p className="text-sm leading-6 text-slate-400">
            Aucun joueur affiché pour l’instant.
          </p>
        )}
      </div>
    </div>
  );
}

function WaitingPlayerCard(props: {
  readonly player: PlayerSummary;
  readonly isCurrentUser: boolean;
  readonly isHost: boolean;
}) {
  const statusTone = getWaitingStatusTone(props.player);

  return (
    <div
      className={clsx(
        "rounded-[22px] border px-4 py-3 transition",
        props.isCurrentUser
          ? "border-cyan-300/35 bg-cyan-300/10"
          : "border-white/8 bg-white/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={clsx(
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                statusTone === "good" &&
                  "bg-lime-300 shadow-[0_0_14px_rgba(190,242,100,0.35)]",
                statusTone === "danger" && "bg-slate-500",
                statusTone === "default" &&
                  "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.35)]",
              )}
            />
            <div className="min-w-0">
              <p className="break-words font-medium text-white">
                {props.player.name}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-400">
                {getPlayerStatusLabel(props.player.status)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {props.isCurrentUser ? (
            <MiniStatusPill label="Toi" tone="default" />
          ) : null}
          {props.isHost ? <MiniStatusPill label="Hôte" tone="default" /> : null}
          {!props.player.connected ? (
            <MiniStatusPill label="Hors ligne" tone="danger" />
          ) : props.player.status === "ready" ? (
            <MiniStatusPill label="Prêt" tone="good" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LeaderboardPlayerCard(props: {
  readonly player: PlayerSummary;
  readonly placement: number;
  readonly isCurrentUser: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-[22px] border px-4 py-3 transition",
        props.isCurrentUser
          ? "border-cyan-300/35 bg-cyan-300/10"
          : "border-white/8 bg-white/[0.03]",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-sm text-white">
            #{props.placement}
          </span>
          <div className="min-w-0">
            <p className="break-words font-medium text-white">
              {props.player.name}
            </p>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              {getPlayerStatusLabel(props.player.status)}
            </p>
          </div>
        </div>
        <span className="number-tabular text-sm text-slate-200">
          {props.player.score} pts
        </span>
      </div>
    </div>
  );
}

function MiniStatusPill(props: {
  readonly label: string;
  readonly tone: "default" | "good" | "danger";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
        props.tone === "good" &&
          "border-lime-300/30 bg-lime-300/10 text-lime-50",
        props.tone === "danger" &&
          "border-slate-400/20 bg-slate-400/10 text-slate-200",
        props.tone === "default" &&
          "border-cyan-300/25 bg-cyan-300/10 text-cyan-50",
      )}
    >
      {props.label}
    </span>
  );
}

function getWaitingStatusTone(
  player: PlayerSummary,
): "default" | "good" | "danger" {
  if (!player.connected || player.status === "left") {
    return "danger";
  }

  if (
    player.status === "ready" ||
    player.status === "playing" ||
    player.status === "solved"
  ) {
    return "good";
  }

  return "default";
}
