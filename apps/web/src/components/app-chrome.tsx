"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const navLinks = [
  { href: "/play", label: "Jouer", tone: "primary" as const },
  { href: "/leaderboard", label: "Classement", tone: "secondary" as const },
  { href: "/profile", label: "Profil", tone: "secondary" as const },
  { href: "/admin", label: "Admin", tone: "secondary" as const }
];

export function AppChrome(props: Readonly<{ children: React.ReactNode; players?: number }>) {
  const pathname = usePathname();
  const isPlayRoute = pathname?.startsWith("/play") ?? false;
  const [players, setPlayers] = useState(props.players);

  useEffect(() => {
    setPlayers(props.players);
  }, [props.players]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMetrics() {
      try {
        const response = await fetch("/api/game/metrics", {
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { players?: number };

        if (!cancelled && typeof payload.players === "number") {
          setPlayers(payload.players);
        }
      } catch {
        // Ignore transient polling failures and keep the last known value.
      }
    }

    void refreshMetrics();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshMetrics();
      }
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshMetrics();
      }
    };

    const handleMetricsRefresh = () => {
      void refreshMetrics();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("motus-metrics-refresh", handleMetricsRefresh);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("motus-metrics-refresh", handleMetricsRefresh);
    };
  }, []);

  return (
    <>
      <header className="shrink-0 z-40 border-b border-white/6 bg-slate-950/45 backdrop-blur-xl">
        <div
          className={clsx(
            "page-shell",
            isPlayRoute
              ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2.5 sm:flex sm:flex-row sm:items-center sm:justify-between sm:py-3"
              : "flex flex-col gap-2.5 py-3 sm:gap-3 sm:py-4 md:flex-row md:items-center md:justify-between md:py-5"
          )}
        >
          <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div
              className={clsx(
                "flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 font-display font-semibold text-cyan-50",
                isPlayRoute ? "h-9 w-9 text-sm sm:h-10 sm:w-10 sm:text-base" : "h-10 w-10 text-base sm:h-11 sm:w-11 sm:text-lg"
              )}
            >
              MR
            </div>
            <div className="min-w-0">
              <p className={clsx("eyebrow flex items-center gap-1.5", isPlayRoute && "text-[10px] tracking-[0.32em] sm:text-[11px] sm:tracking-[0.38em]")}>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
                </span>
                <span className="max-[360px]:hidden">
                  {players !== undefined ? `${players} ${players > 1 ? "joueurs connectés" : "joueur connecté"}` : "Arène de mots en direct"}
                </span>
                <span className="hidden max-[360px]:inline">{players !== undefined ? `${players} en ligne` : "Live"}</span>
              </p>
              <p className={clsx("truncate font-display font-semibold text-white", isPlayRoute ? "text-[0.98rem] leading-tight sm:text-lg" : "text-base leading-tight sm:text-lg")}>
                Motus Royale
              </p>
            </div>
          </Link>

          <nav
            className={clsx(
              isPlayRoute
                ? "col-start-2 flex w-auto flex-nowrap items-center justify-end gap-1.5 overflow-x-auto pb-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                : "flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] md:w-auto md:flex-wrap md:justify-end md:overflow-visible md:pb-0"
            )}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  link.tone === "primary" ? "button-primary" : "button-secondary",
                  pathname === link.href && link.tone === "secondary" && "border-cyan-300/30 bg-cyan-300/12 text-cyan-50",
                  isPlayRoute
                    ? "min-h-9 shrink-0 whitespace-nowrap px-3 py-1.5 text-[13px] sm:min-h-10 sm:px-4 sm:py-2 sm:text-sm"
                    : "min-h-10 shrink-0 whitespace-nowrap px-3 py-2 text-sm md:min-h-11 md:px-4",
                  isPlayRoute && "max-[360px]:px-2.5 max-[360px]:text-[12px]",
                  isPlayRoute && link.href === "/admin" && "hidden xl:inline-flex",
                  !isPlayRoute ? "md:w-auto" : ""
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className={clsx("flex flex-1 flex-col overflow-x-clip", isPlayRoute && "min-h-0 overflow-y-auto")}>{props.children}</main>
    </>
  );
}
