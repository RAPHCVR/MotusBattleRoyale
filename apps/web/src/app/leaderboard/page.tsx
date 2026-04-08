import { GlassPanel, SectionHeader } from "@motus/ui";

import { getLeaderboard } from "@/lib/player-profile";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard();

  return (
    <div className="page-shell space-y-5 py-6 md:py-8">
      <SectionHeader
        eyebrow="Classement"
        title="Les meilleurs profils du moment"
        body="Le matchmaking reste discret, mais les profils les plus solides remontent ici avec leurs victoires, leur volume de jeu et leur meilleure place."
      />

      <div className="space-y-2.5 md:hidden">
        {leaderboard.map((player, index) => (
          <GlassPanel key={player.userId} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Rank #{index + 1}</p>
                <h3 className="mt-2 break-words font-display text-xl text-white sm:text-2xl">{player.displayName}</h3>
                <p className="mt-2 text-sm text-slate-400">{player.matchesPlayed} matchs joués</p>
              </div>
              <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-sm text-cyan-50">
                #{index + 1}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <p className="eyebrow">MMR</p>
                <p className="number-tabular mt-2 text-lg text-white">{player.mmr}</p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <p className="eyebrow">Victoires</p>
                <p className="number-tabular mt-2 text-lg text-white">{player.wins}</p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <p className="eyebrow">Meilleure place</p>
                <p className="number-tabular mt-2 text-lg text-white">{player.bestFinish ?? "-"}</p>
              </div>
            </div>
          </GlassPanel>
        ))}
      </div>

      <GlassPanel className="hidden overflow-hidden md:block">
        <div className="grid grid-cols-[72px_1.4fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-white/8 px-4 py-3.5 text-[11px] uppercase tracking-[0.28em] text-slate-400">
          <span>Rang</span>
          <span>Joueur</span>
          <span>MMR</span>
          <span>Victoires</span>
          <span>Meilleure place</span>
        </div>

        <div className="divide-y divide-white/6">
          {leaderboard.map((player, index) => (
            <div
              key={player.userId}
              className="grid grid-cols-[72px_1.4fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3.5 text-sm text-slate-200"
            >
              <span className="font-display text-2xl text-white">#{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{player.displayName}</p>
                <p className="text-xs text-slate-400">{player.matchesPlayed} matchs joués</p>
              </div>
              <span className="number-tabular">{player.mmr}</span>
              <span className="number-tabular">{player.wins}</span>
              <span className="number-tabular">{player.bestFinish ?? "-"}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
