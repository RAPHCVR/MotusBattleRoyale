import { GlassPanel, SectionHeader } from "@motus/ui";

import {
  getLeaderboardSnapshot,
  type PlayerProfile,
} from "@/lib/player-profile";

export const dynamic = "force-dynamic";

function LeaderboardCards(props: {
  players: PlayerProfile[];
  rankOffset?: number;
  showQualificationHint?: boolean;
  minimumMatches?: number;
}) {
  const rankOffset = props.rankOffset ?? 0;

  return (
    <div className="space-y-2.5 md:hidden">
      {props.players.map((player, index) => (
        <GlassPanel key={player.userId} className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Rank #{rankOffset + index + 1}</p>
              <h3
                className="mt-2 truncate font-display text-xl text-white sm:text-2xl"
                title={player.displayName}
              >
                {player.displayName}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                {player.matchesPlayed} matchs joués
                {props.showQualificationHint && props.minimumMatches
                  ? ` · provisoire avant ${props.minimumMatches}`
                  : ""}
              </p>
            </div>
            <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-sm text-cyan-50">
              #{rankOffset + index + 1}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <p className="eyebrow">MMR</p>
              <p className="number-tabular mt-2 text-lg text-white">
                {player.mmr}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <p className="eyebrow">Victoires</p>
              <p className="number-tabular mt-2 text-lg text-white">
                {player.wins}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <p className="eyebrow">Meilleure place</p>
              <p className="number-tabular mt-2 text-lg text-white">
                {player.bestFinish ?? "-"}
              </p>
            </div>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

function LeaderboardTable(props: {
  title: string;
  players: PlayerProfile[];
  rankOffset?: number;
  showQualificationHint?: boolean;
  minimumMatches?: number;
}) {
  const rankOffset = props.rankOffset ?? 0;

  return (
    <GlassPanel className="hidden overflow-hidden md:block">
      <div className="border-b border-white/8 px-4 py-3.5">
        <p className="eyebrow">{props.title}</p>
        {props.showQualificationHint && props.minimumMatches ? (
          <p className="mt-2 text-sm text-slate-400">
            Profils encore provisoires avant {props.minimumMatches} matchs.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-[72px_1.4fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-white/8 px-4 py-3.5 text-[11px] uppercase tracking-[0.28em] text-slate-400">
        <span>Rang</span>
        <span>Joueur</span>
        <span>MMR</span>
        <span>Victoires</span>
        <span>Meilleure place</span>
      </div>

      <div className="divide-y divide-white/6">
        {props.players.map((player, index) => (
          <div
            key={player.userId}
            className="grid grid-cols-[72px_1.4fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3.5 text-sm text-slate-200"
          >
            <span className="font-display text-2xl text-white">
              #{rankOffset + index + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-white">
                {player.displayName}
              </p>
              <p className="text-xs text-slate-400">
                {player.matchesPlayed} matchs joués
                {props.showQualificationHint && props.minimumMatches
                  ? ` · provisoire`
                  : ""}
              </p>
            </div>
            <span className="number-tabular">{player.mmr}</span>
            <span className="number-tabular">{player.wins}</span>
            <span className="number-tabular">{player.bestFinish ?? "-"}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboardSnapshot();

  return (
    <div className="page-shell space-y-5 py-6 md:py-8">
      <SectionHeader
        eyebrow="Classement"
        title="Les meilleurs profils du moment"
        body={`Le MMR de matchmaking reste live, mais le leaderboard public ne classe que les profils qualifiés apres ${leaderboard.minimumMatches} matchs. Les comptes encore en rodage restent visibles a part.`}
      />

      <GlassPanel className="space-y-3">
        <p className="eyebrow">Qualification</p>
        <p className="text-sm leading-6 text-slate-300">
          Un profil entre dans le classement principal apres{" "}
          <span className="font-semibold text-white">
            {leaderboard.minimumMatches} matchs enregistres
          </span>
          . Avant ca, son MMR continue a servir pour le matchmaking mais son
          affichage reste provisoire.
        </p>
      </GlassPanel>

      <div className="space-y-3">
        <SectionHeader
          eyebrow="Classement qualifie"
          title="Profils confirmes"
          body="Ce tableau sert de vitrine publique: il demande un petit volume de jeu pour eviter les faux tops a tres faible echantillon."
        />

        <LeaderboardCards players={leaderboard.established} />
        <LeaderboardTable
          title="Profils confirmes"
          players={leaderboard.established}
        />
      </div>

      {leaderboard.provisional.length > 0 ? (
        <div className="space-y-3">
          <SectionHeader
            eyebrow="Provisoire"
            title="Profils en rodage"
            body="Ils ont deja un MMR live pour les rooms et le matchmaking, mais il leur manque encore quelques matchs pour entrer dans le classement principal."
          />

          <LeaderboardCards
            players={leaderboard.provisional}
            showQualificationHint
            minimumMatches={leaderboard.minimumMatches}
          />
          <LeaderboardTable
            title="Profils provisoires"
            players={leaderboard.provisional}
            showQualificationHint
            minimumMatches={leaderboard.minimumMatches}
          />
        </div>
      ) : null}
    </div>
  );
}
