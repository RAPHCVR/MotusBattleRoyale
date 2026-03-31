"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const navLinks = [
  { href: "/play", label: "Jouer", tone: "primary" as const },
  { href: "/leaderboard", label: "Leaderboard", tone: "secondary" as const },
  { href: "/profile", label: "Profil", tone: "secondary" as const },
  { href: "/admin", label: "Admin", tone: "secondary" as const }
];

export function AppChrome(props: Readonly<{ children: React.ReactNode; players?: number }>) {
  const pathname = usePathname();
  const isPlayRoute = pathname?.startsWith("/play") ?? false;

  return (
    <>
      <header className="shrink-0 z-40 border-b border-white/6 bg-slate-950/45 backdrop-blur-xl">
        <div
          className={clsx(
            "page-shell flex gap-3 md:flex-row md:items-center md:justify-between",
            isPlayRoute ? "py-3 sm:py-4" : "flex-col py-4 sm:py-5 md:py-6"
          )}
        >
          <Link href="/" className="flex items-center gap-3">
            <div
              className={clsx(
                "flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 font-display font-semibold text-cyan-50",
                isPlayRoute ? "h-10 w-10 text-base" : "h-11 w-11 text-lg"
              )}
            >
              MR
            </div>
            <div>
              <p className="eyebrow flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
                </span>
                {props.players !== undefined ? `${props.players} ${props.players > 1 ? 'joueurs en ligne' : 'joueur en ligne'}` : "Live Word Arena"}
              </p>
              <p className={clsx("font-display font-semibold text-white", isPlayRoute ? "text-base sm:text-lg" : "text-lg")}>
                Motus Royale
              </p>
            </div>
          </Link>

          <nav
            className={clsx(
              isPlayRoute
                ? "flex w-full gap-2 overflow-x-auto pb-1 md:w-auto md:justify-end [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                : "grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:grid-cols-none md:justify-end"
            )}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  link.tone === "primary" ? "button-primary" : "button-secondary",
                  isPlayRoute
                    ? "min-h-10 shrink-0 whitespace-nowrap px-3 py-2 text-sm sm:px-4"
                    : "w-full whitespace-nowrap md:w-auto"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-clip flex flex-col">{props.children}</main>

      {!isPlayRoute ? (
        <footer className="shrink-0 border-t border-white/6 py-8 text-center text-sm text-slate-400">
          <div className="page-shell flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p>FR-first realtime puzzle arena. Local, tunnel, puis prod sur la même topo.</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/play" className="text-cyan-200 transition hover:text-cyan-50">
                Lancer une partie
              </Link>
              <Link href="/admin" className="text-cyan-200 transition hover:text-cyan-50">
                Vérifier l’infra
              </Link>
            </div>
          </div>
        </footer>
      ) : null}
    </>
  );
}
