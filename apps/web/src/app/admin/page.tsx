import {
  getDictionaryStats,
  type DictionarySourceStat,
} from "@motus/dictionary/word-bank";
import { GlassPanel, SectionHeader } from "@motus/ui";

import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const dictionaryStats = getDictionaryStats();
  const checks = [
    ["App URL", env.NEXT_PUBLIC_APP_URL],
    ["Auth Base", env.AUTH_BASE_URL],
    ["Game WS", env.NEXT_PUBLIC_GAME_WS_URL],
    ["Game Internal", env.GAME_SERVER_INTERNAL_URL],
    ["Passkey RP ID", env.PASSKEY_RP_ID],
    ["Passkey Origins", env.PASSKEY_ORIGINS.join(", ")]
  ];

  return (
    <div className="page-shell space-y-5 py-6 md:py-8">
      <SectionHeader
        eyebrow="Admin"
        title="Local → tunnel → prod sans changer d’architecture"
        body="Cette page sert de contrôle rapide pour les URLs, le RP ID passkey et les dépendances infra attendues autour du site."
      />

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <GlassPanel className="space-y-3.5">
          <h2 className="font-display text-2xl text-white sm:text-3xl">Checklist</h2>
          <ul className="space-y-2.5 text-sm leading-6 text-slate-300">
            <li>
              1. <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">postgres</code>,{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">redis</code>,{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">game</code>,{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">web</code> et{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">caddy</code> montent en{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">docker compose up</code>.
            </li>
            <li>
              2. <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">cloudflared</code> pointe{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">motus.*</code> vers Caddy, et{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">/realtime</code> est proxyfié vers le game.
            </li>
            <li>3. Le navigateur voit les cookies Better Auth sur le hostname tunnelisé.</li>
            <li>4. La passkey est testée uniquement sur le vrai RP ID prévu.</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="space-y-3.5">
          <h2 className="font-display text-2xl text-white sm:text-3xl">Valeurs runtime</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map(([label, value]) => (
              <div key={label} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3.5 py-3">
                <p className="eyebrow">{label}</p>
                <p className="mt-2 break-all text-sm text-white">{value}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="space-y-4">
        <h2 className="font-display text-2xl text-white sm:text-3xl">Banque de mots</h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          Les mots solution viennent maintenant d’un pool curé + fréquentiel, séparé du lexique de guesses. Les guesses
          valides, eux, sont contrôlés contre une vraie wordlist française filtrée sur les longueurs de partie, avec
          blacklist anti-profanité normalisée.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
            <p className="eyebrow">Solutions</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.solutionCount}</p>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
            <p className="eyebrow">Essais autorisés</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.allowedCount}</p>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
            <p className="eyebrow">Termes bloqués</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.bannedCount}</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dictionaryStats.lengths.map((lengthStats) => (
            <div key={lengthStats.length} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
              <p className="eyebrow">{lengthStats.length} lettres</p>
              <p className="mt-2 text-sm text-slate-300">{lengthStats.solutions} solutions curées</p>
              <p className="mt-1 text-sm text-slate-300">{lengthStats.allowed} guesses autorisés</p>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <p className="eyebrow">Sources</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Chaque source est dédupliquée après normalisation. Les counts ci-dessous montrent ce qui a vraiment été
              accepté dans la banque finale.
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {dictionaryStats.sources.map((source: DictionarySourceStat) => (
              <div key={source.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">{source.role}</p>
                    <p className="mt-2 break-all text-sm font-medium text-white">{source.label}</p>
                  </div>
                  <p className="number-tabular text-sm text-slate-200">
                    {source.acceptedEntries}/{source.normalizedEntries}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {source.lengths.map((lengthStats: DictionarySourceStat["lengths"][number]) => (
                    <span
                      key={`${source.id}-${lengthStats.length}`}
                      className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-200"
                    >
                      {lengthStats.length}L: {lengthStats.accepted}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
