import Link from "next/link";

import { GlassPanel, MetricBadge, SectionHeader, WordTile } from "@motus/ui";
import { getGameMetrics } from "@/lib/game-server";

const heroSignals = [
  { label: "Queue live", tone: "signal-pill-live" },
  { label: "FR natif", tone: "signal-pill-lime" },
  { label: "Score temps réel", tone: "signal-pill-amber" }
];

const liveFeed = [
  { label: "Match public", body: "Entrée rapide, montée progressive en charge et départ lisible." },
  { label: "Repères clairs", body: "Vert, ambre, cyan, ardoise: chaque état se distingue tout de suite." },
  { label: "Finale tendue", body: "7 manches, cut, finale top 4 et score toujours visible." }
];

const heroWordPreview: Array<{
  letter: string;
  state?: "correct" | "present" | "absent" | "pending";
  hint?: boolean;
}> = [
  { letter: "A", state: "correct", hint: true },
  { letter: "R", state: "present" },
  { letter: "E", state: "absent" },
  { letter: "N", state: "pending" },
  { letter: "A", state: "pending" },
  { letter: "_" }
];

const pillars = [
  {
    title: "Lisibilité compétitive",
    body: "Chaque état de lettre se différencie immédiatement. Le joueur n’a pas à deviner l’interface en pleine manche."
  },
  {
    title: "Même langage partout",
    body: "Le home, les surfaces et la partie parlent la même langue visuelle pour éviter les ruptures de repères."
  },
  {
    title: "Déploiement propre",
    body: "Local, preview et prod gardent la même logique pour éviter les surprises côté auth, cookies et WebSocket."
  }
];

const launchSteps = [
  ["01", "Session express", "Entre en invité puis garde ton profil si tu veux créer un compte."],
  ["02", "Public ou privé", "Match public rapide ou salon à code pour jouer entre amis."],
  ["03", "Lecture immédiate", "Les retours se comprennent en un coup d’œil, même sur mobile."]
];

export default async function HomePage() {
  const metrics = await getGameMetrics();

  const heroMetrics = [
    { label: "Joueurs connectés", value: `${metrics.players}` },
    { label: "Salons actifs", value: `${metrics.rooms}` },
    { label: "Latence", value: "114 ms p95" }
  ];

  return (
    <div className="page-shell space-y-10 py-8 md:py-16">
      <section className="space-y-4">
        <GlassPanel className="overflow-hidden p-5 sm:p-6 md:p-7">
          <div className="grid gap-8 xl:grid-cols-[1.04fr_0.96fr] xl:gap-10">
            <div className="min-w-0 space-y-6">
              <div className="flex flex-wrap gap-2">
                {heroSignals.map((signal) => (
                  <span key={signal.label} className={`signal-pill ${signal.tone}`}>
                    {signal.label}
                  </span>
                ))}
              </div>

              <div className="space-y-4">
                <p className="eyebrow">Arène de mots</p>
                <h1 className="max-w-[12ch] text-balance font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-7xl">
                  Une arène de mots qui se comprend en un regard.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                  Tu entres, tu comprends l’état de la manche, puis tu joues tout de suite. L’interface reste nette sur
                  desktop comme sur téléphone.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/play" className="button-primary">
                  Jouer maintenant
                </Link>
                <Link href="/leaderboard" className="button-secondary">
                  Voir le classement
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricBadge label="Format" value="7 manches / top 4" />
                <MetricBadge label="Temps réel" value="Colyseus + WebSocket" tone="good" />
                <MetricBadge label="Session" value="Invité ou compte" />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {launchSteps.map(([step, title, body]) => (
                  <div key={step} className="signal-card">
                    <p className="eyebrow">{step}</p>
                    <h3 className="mt-3 font-display text-xl text-white">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>
                  </div>
                ))}
              </div>
            </div>

              <div className="min-w-0">
                <div className="arcade-screen">
                  <div className="relative z-10 space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow">Aperçu de partie</p>
                        <h2 className="mt-2 font-display text-3xl text-white sm:text-4xl">Lecture immédiate</h2>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                          Le home reprend déjà la lecture de la partie: mêmes couleurs, mêmes surfaces, même hiérarchie.
                        </p>
                      </div>
                      <MetricBadge label="Manche" value="00:41" tone="danger" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {heroMetrics.map((metric) => (
                      <div key={metric.label} className="signal-card">
                        <p className="eyebrow">{metric.label}</p>
                        <p className="number-tabular mt-3 font-display text-3xl text-white">{metric.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-[26px] border border-white/8 bg-slate-950/75 p-4">
                    <div className="grid grid-cols-6 gap-2 sm:gap-3">
                      {heroWordPreview.map((tile, index) => (
                        <WordTile key={index} letter={tile.letter} state={tile.state} hint={tile.hint} />
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="w-11 shrink-0">
                          <WordTile letter="A" state="correct" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Vert plein</p>
                          <p className="text-xs leading-5 text-slate-400">Bonne lettre, bonne case.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="w-11 shrink-0">
                          <WordTile letter="A" state="present" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Ambre</p>
                          <p className="text-xs leading-5 text-slate-400">Bonne lettre, autre case.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="w-11 shrink-0">
                          <WordTile letter="A" hint />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Bloc cyan</p>
                          <p className="text-xs leading-5 text-slate-400">Lettre révélée et verrouillée.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-3">
                        <div className="w-11 shrink-0">
                          <WordTile letter="A" state="absent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Ardoise</p>
                          <p className="text-xs leading-5 text-slate-400">Lettre sortie du round.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {liveFeed.map((item, index) => (
                      <div key={item.label} className="flex items-start justify-between gap-4 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium text-white">{item.label}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-300">{item.body}</p>
                        </div>
                        <span className="number-tabular rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-50">
                          0{index + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </section>

      <section className="space-y-6">
        <SectionHeader
          eyebrow="Lisibilité"
          title="Chaque écran doit se lire à vitesse de jeu"
          body="La lecture doit survivre au stress, au mobile et à la vision périphérique. Le site n’a pas le droit d’être joli mais ambigu."
        />

        <div className="grid gap-5 md:grid-cols-3">
          {pillars.map((pillar) => (
            <GlassPanel key={pillar.title} className="space-y-4">
              <p className="eyebrow">Pilier</p>
              <h3 className="font-display text-2xl text-white">{pillar.title}</h3>
              <p className="text-sm leading-6 text-slate-300">{pillar.body}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <GlassPanel className="space-y-5">
          <SectionHeader
            eyebrow="Déploiement"
            title="Même base du localhost à la prod"
            body="La boucle locale, la preview et l’ouverture publique gardent la même logique pour éviter les surprises côté auth et WebSocket."
          />
          <div className="space-y-3 text-sm leading-6 text-slate-300">
            <p>
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">web</code> sert le site, l’auth et les
              tickets de partie.
            </p>
            <p>
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">game</code> gère le matchmaking, les
              salons et le scoring autoritaire.
            </p>
            <p>
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">caddy</code> et{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-cyan-100">cloudflared</code> exposent les
              sous-domaines sans ouvrir de ports entrants.
            </p>
          </div>
        </GlassPanel>

        <GlassPanel className="space-y-6">
          <SectionHeader
            eyebrow="Entrée en partie"
            title="Entrer sans friction"
            body="Le parcours reste direct: tu crées ta session, tu entres en partie, puis l’interface garde les mêmes repères du home au match."
            action={
              <Link href="/play" className="button-primary">
                Ouvrir le jeu
              </Link>
            }
          />

          <div className="grid gap-4 md:grid-cols-3">
            {launchSteps.map(([step, title, body]) => (
              <div key={step} className="signal-card">
                <p className="eyebrow">{step}</p>
                <h3 className="mt-3 font-display text-2xl text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
