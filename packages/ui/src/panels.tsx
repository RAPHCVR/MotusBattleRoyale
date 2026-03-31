import clsx from "clsx";
import type { PropsWithChildren, ReactNode } from "react";

export function GlassPanel(props: PropsWithChildren<{ className?: string }>) {
  return (
    <section
      className={clsx(
        "min-w-0 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(19,30,54,0.92),rgba(5,11,24,0.88))] p-4 shadow-[0_24px_80px_rgba(1,8,20,0.5)] backdrop-blur-xl sm:rounded-[28px] sm:p-5",
        props.className
      )}
    >
      {props.children}
    </section>
  );
}

export function MetricBadge(props: { label: string; value: ReactNode; tone?: "default" | "good" | "danger" }) {
  return (
    <div
      className={clsx(
        "min-w-0 rounded-[18px] border px-3 py-2 text-[10px] uppercase tracking-[0.2em] sm:rounded-full sm:px-4 sm:text-xs sm:tracking-[0.28em]",
        props.tone === "good" && "border-lime-400/40 bg-lime-400/10 text-lime-200",
        props.tone === "danger" && "border-rose-400/35 bg-rose-400/10 text-rose-100",
        props.tone === "default" && "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
      )}
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-white/50">{props.label}</span>
        <strong className="break-words font-semibold text-white">{props.value}</strong>
      </div>
    </div>
  );
}

export function SectionHeader(props: { eyebrow: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.38em] text-cyan-200/70">{props.eyebrow}</p>
        <h2 className="text-balance font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl md:text-4xl">
          {props.title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-300">{props.body}</p>
      </div>
      {props.action ? <div className="w-full md:w-auto [&>*]:w-full md:[&>*]:w-auto">{props.action}</div> : null}
    </div>
  );
}
