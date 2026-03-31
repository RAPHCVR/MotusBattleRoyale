import { getDictionaryStats } from "@motus/dictionary/word-bank";
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
    ["Passkey Origin", env.PASSKEY_ORIGIN]
  ];

  return (
    <div className="page-shell space-y-6 py-8 md:py-10">
      <SectionHeader
        eyebrow="Ops Surface"
        title="Local → tunnel → prod sans changer d’architecture"
        body="Cette page sert de check rapide pour les URLs, le passkey RP ID et les dépendances infra attendues autour du site."
      />

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <GlassPanel className="space-y-4">
          <h2 className="font-display text-3xl text-white">Checklist</h2>
          <ul className="space-y-3 text-sm leading-6 text-slate-300">
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
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">play-dev.*</code> et{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">rt-dev.*</code> vers Caddy.
            </li>
            <li>3. Le navigateur voit les cookies Better Auth sur le hostname tunnelisé.</li>
            <li>4. La passkey est testée uniquement sur le vrai RP ID prévu.</li>
          </ul>
        </GlassPanel>

        <GlassPanel className="space-y-4">
          <h2 className="font-display text-3xl text-white">Runtime Values</h2>
          <div className="space-y-3">
            {checks.map(([label, value]) => (
              <div key={label} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3">
                <p className="eyebrow">{label}</p>
                <p className="mt-2 break-all text-sm text-white">{value}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="space-y-4">
        <h2 className="font-display text-3xl text-white">Word Bank</h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          Les mots solution restent curés pour garder des rounds propres. Les guesses valides, eux, sont contrôlés contre
          une vraie wordlist française filtrée sur les longueurs de partie, avec blacklist anti-profanité normalisée.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <p className="eyebrow">Solutions</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.solutionCount}</p>
          </div>
          <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <p className="eyebrow">Allowed Guesses</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.allowedCount}</p>
          </div>
          <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <p className="eyebrow">Blocked Terms</p>
            <p className="number-tabular mt-2 text-3xl text-white">{dictionaryStats.bannedCount}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {dictionaryStats.lengths.map((lengthStats) => (
            <div key={lengthStats.length} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
              <p className="eyebrow">{lengthStats.length} lettres</p>
              <p className="mt-2 text-sm text-slate-300">{lengthStats.solutions} solutions curées</p>
              <p className="mt-1 text-sm text-slate-300">{lengthStats.allowed} guesses autorisés</p>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
