import Link from "next/link";

import { GlassPanel, MetricBadge, SectionHeader } from "@motus/ui";

import { ensurePlayerProfile } from "@/lib/player-profile";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession();
  const profile = session ? await ensurePlayerProfile(session.user) : null;

  return (
    <div className="page-shell space-y-5 py-6 md:py-8">
      <SectionHeader
        eyebrow="Profil"
        title="Compte, stats et identité de jeu"
        body="Le profil regroupe ton nom affiché, ton seed avatar et tes stats pour garder une identité cohérente entre le site et les parties."
      />

      {!session || !profile ? (
        <GlassPanel className="space-y-3.5">
          <h2 className="font-display text-2xl text-white sm:text-3xl">Aucune session active</h2>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Lance une session invitée ou connecte-toi depuis l’arène de jeu pour créer ton profil automatiquement.
          </p>
          <Link href="/play" className="button-primary w-full sm:w-auto">
            Aller jouer
          </Link>
        </GlassPanel>
      ) : (
        <GlassPanel className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <MetricBadge label="Player" value={profile.displayName} />
            <MetricBadge label="MMR" value={profile.mmr} tone="good" />
            <MetricBadge label="Wins" value={profile.wins} />
            <MetricBadge label="Best" value={profile.bestFinish ?? "-"} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
              <p className="eyebrow">Session</p>
              <h3 className="mt-3 break-words font-display text-xl text-white sm:text-2xl">{session.user.name}</h3>
              <p className="mt-2 break-all text-sm text-slate-300">{session.user.email}</p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Les actions de connexion, de conversion invité → compte et d’ajout de passkey se font depuis la page de
                jeu pour garder une seule boucle claire.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 sm:p-5">
              <p className="eyebrow">Identité de jeu</p>
              <h3 className="mt-3 break-all font-display text-xl text-white sm:text-2xl">{profile.avatarSeed}</h3>
              <p className="mt-2 text-sm text-slate-300">{profile.matchesPlayed} matchs enregistrés</p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Le seed avatar et le nom affiché sont stockés côté backend puis réutilisés par le serveur de jeu pour les
                tickets et le classement.
              </p>
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
