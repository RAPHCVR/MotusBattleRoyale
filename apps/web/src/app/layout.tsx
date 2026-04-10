import type { Metadata, Viewport } from "next";

import { AppChrome } from "@/components/app-chrome";
import { getGameMetrics } from "@/lib/game-server";

import "./globals.css";

export const metadata: Metadata = {
  title: "Motus Royale",
  description: "Motus-like battle royale moderne, temps réel et FR-first.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#050a16",
};

export default async function RootLayout(
  props: Readonly<{ children: React.ReactNode }>,
) {
  const metrics = await getGameMetrics();

  return (
    <html lang="fr">
      <body className="antialiased flex min-h-[100dvh] flex-col overflow-x-clip">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-8%] top-[-10%] h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="absolute bottom-[-16%] right-[-8%] h-80 w-80 rounded-full bg-lime-400/10 blur-3xl" />
          <div className="surface-grid absolute inset-0 opacity-40" />
        </div>

        <AppChrome players={metrics.players}>{props.children}</AppChrome>
      </body>
    </html>
  );
}
