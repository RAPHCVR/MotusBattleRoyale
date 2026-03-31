import Link from "next/link";

import { GlassPanel, MetricBadge, SectionHeader } from "@motus/ui";

import { ensurePlayerProfile } from "@/lib/player-profile";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession();
  const profile = session ? await ensurePlayerProfile(session.user) : null;

  return (
    <div className="page-shell space-y-6 py-8 md:py-10">
      <SectionHeader
        eyebrow="Player Profile"
        title="Compte, stats et identité de jeu"
        body="Le profil s’aligne sur l’auth et le backend de match pour garder un display name, un seed avatar et un MMR cohérents."
      />

      {!session || !profile ? (
        <GlassPanel className="space-y-4">
          <h2 className="font-display text-3xl text-white">Aucune session active</h2>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Lance une session invitée ou connecte-toi depuis l’arène de jeu pour créer ton profil automatiquement.
          </p>
          <Link href="/play" className="button-primary w-full sm:w-auto">
            Aller jouer
          </Link>
        </GlassPanel>
      ) : (
        <GlassPanel className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <MetricBadge label="Player" value={profile.displayName} />
            <MetricBadge label="MMR" value={profile.mmr} tone="good" />
            <MetricBadge label="Wins" value={profile.wins} />
            <MetricBadge label="Best" value={profile.bestFinish ?? "-"} />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
              <p className="eyebrow">Session</p>
              <h3 className="mt-3 break-words font-display text-2xl text-white">{session.user.name}</h3>
              <p className="mt-2 break-all text-sm text-slate-300">{session.user.email}</p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Les actions de connexion, upgrade invité → compte et ajout de passkey sont pilotées depuis la page de jeu
                pour garder une seule boucle UI.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
              <p className="eyebrow">Game Identity</p>
              <h3 className="mt-3 break-all font-display text-2xl text-white">{profile.avatarSeed}</h3>
              <p className="mt-2 text-sm text-slate-300">{profile.matchesPlayed} matchs enregistrés</p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Le seed avatar et le display name sont stockés côté backend et réutilisés par le serveur de jeu pour les
                tickets et les classements.
              </p>
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
