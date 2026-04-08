import clsx from "clsx";

import type { GuessTileState } from "@motus/protocol";

export type WordTileTone = "correct" | "present" | "absent" | "pending" | "hint" | "idle";

export function resolveWordTileTone(props: { state?: GuessTileState; hint?: boolean }): WordTileTone {
  if (props.state === "correct") {
    return "correct";
  }

  if (props.state === "present") {
    return "present";
  }

  if (props.state === "absent") {
    return "absent";
  }

  if (props.state === "pending") {
    return "pending";
  }

  if (props.hint) {
    return "hint";
  }

  return "idle";
}

export function FeedbackToneIcon(props: { tone: Exclude<WordTileTone, "idle" | "pending">; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-block shrink-0 border",
        props.tone === "correct" && "rounded-[0.32rem] border-lime-100/80 bg-lime-300 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]",
        props.tone === "present" && "rounded-full border-[1.6px] border-amber-100/85 bg-transparent",
        props.tone === "absent" && "rounded-full border-slate-400/30 bg-slate-500/35",
        props.tone === "hint" && "rounded-[0.32rem] border-cyan-100/80 bg-cyan-300 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]",
        props.className
      )}
    />
  );
}

export function WordTile(props: { letter?: string; state?: GuessTileState; hint?: boolean; compact?: boolean; dense?: boolean }) {
  const tone = resolveWordTileTone(props);

  return (
    <div
      className={clsx(
        props.compact
          ? "relative isolate flex aspect-square min-h-7 items-center justify-center overflow-hidden rounded-lg border text-center font-display text-[0.95rem] font-semibold uppercase tracking-[0.12em] transition sm:min-h-8 sm:text-[1rem]"
          : props.dense
            ? "relative isolate flex aspect-square min-h-8 items-center justify-center overflow-hidden rounded-[0.95rem] border text-center font-display text-[1.05rem] font-semibold uppercase tracking-[0.12em] transition sm:min-h-9 sm:rounded-[1.1rem] sm:text-[1.2rem] sm:tracking-[0.16em]"
          : "relative isolate flex aspect-square min-h-10 items-center justify-center overflow-hidden rounded-xl border text-center font-display text-xl font-semibold uppercase tracking-[0.12em] transition sm:min-h-12 sm:rounded-2xl sm:text-2xl sm:tracking-[0.18em]",
        tone === "correct" && "border-lime-200/90 bg-lime-300 text-slate-950 shadow-[0_16px_28px_rgba(178,255,82,0.18)]",
        tone === "present" && "border-amber-200/90 bg-amber-300 text-slate-950 shadow-[0_14px_26px_rgba(255,190,85,0.16)]",
        tone === "absent" && "border-slate-700/90 bg-slate-800 text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]",
        tone === "pending" && "border-cyan-300/45 bg-cyan-300/10 text-cyan-50",
        tone === "idle" && "border-white/10 bg-slate-950/72 text-white/30",
        tone === "hint" && "border-cyan-200/75 bg-cyan-300 text-slate-950 shadow-[0_12px_22px_rgba(34,211,238,0.14)]"
      )}
    >
      <span className="pointer-events-none absolute inset-[1px] rounded-[inherit] border border-white/8" />

      {tone === "pending" ? (
        <span className="pointer-events-none absolute inset-[3px] rounded-[inherit] border border-dashed border-cyan-200/45" />
      ) : null}

      <span
        className={clsx(
          "relative z-10",
          (tone === "correct" || tone === "present" || tone === "hint") && "drop-shadow-[0_1px_0_rgba(255,255,255,0.12)]",
          tone === "idle" && "opacity-80"
        )}
      >
        {props.letter ?? ""}
      </span>
    </div>
  );
}
