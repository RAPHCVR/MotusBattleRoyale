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

export function MetricBadge(props: { label: string; value: ReactNode; tone?: "default" | "good" | "danger"; compact?: boolean }) {
  return (
    <div
      className={clsx(
        props.compact ? "max-w-full min-w-0 rounded-[14px] border px-2.5 py-2 sm:rounded-[16px]" : "max-w-full min-w-0 rounded-[16px] border px-3 py-2.5 sm:rounded-full sm:px-4",
        props.tone === "good" && "border-lime-400/40 bg-lime-400/10 text-lime-200",
        props.tone === "danger" && "border-rose-400/35 bg-rose-400/10 text-rose-100",
        props.tone === "default" && "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
      )}
    >
      {props.compact ? (
        <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
          <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/55">{props.label}</span>
          <span aria-hidden="true" className="text-[0.7rem] text-white/20">
            •
          </span>
          <strong className="block min-w-0 max-w-full truncate whitespace-nowrap text-[0.8rem] font-semibold leading-none text-white">{props.value}</strong>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
          <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-white/55 sm:text-[10px] sm:tracking-[0.28em]">{props.label}</span>
          <span aria-hidden="true" className="hidden h-3 w-px bg-white/10 sm:block" />
          <strong className="block min-w-0 max-w-full truncate whitespace-nowrap text-sm font-semibold leading-snug text-white sm:text-[0.95rem]">{props.value}</strong>
        </div>
      )}
    </div>
  );
}

export function SectionHeader(props: { eyebrow: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <p className="eyebrow">{props.eyebrow}</p>
        <h2 className="text-balance font-display text-[1.85rem] font-semibold tracking-tight text-white sm:text-3xl md:text-4xl">
          {props.title}
        </h2>
        <p className="max-w-2xl text-[0.95rem] leading-6 text-slate-300 sm:text-sm">{props.body}</p>
      </div>
      {props.action ? <div className="w-full md:w-auto md:self-start [&>*]:w-full md:[&>*]:w-auto">{props.action}</div> : null}
    </div>
  );
}
