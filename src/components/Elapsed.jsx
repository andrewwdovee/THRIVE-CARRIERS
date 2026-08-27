import React, { useState, useEffect } from "react";

/* The stopwatch.

   Starts the moment an order is paid for and runs until someone marks it
   delivered — then it freezes at whatever it took. A running order ticks
   every second; a delivered one is a fixed number and never re-renders. */

export function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return d ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

/* Elapsed time for one order. Ticks itself so a running clock never drags
   the whole board through a re-render every second. */
export function useElapsed(startedAt, stoppedAt) {
  const running = !stoppedAt;
  const [, bump] = useState(0);

  useEffect(() => {
    if (!running) return;
    // Line each tick up with the wall-clock second so the digits don't stutter.
    let id;
    const tick = () => {
      bump((n) => n + 1);
      id = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    id = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(id);
  }, [running]);

  return (stoppedAt || Date.now()) - startedAt;
}

/* One order's clock. `target` is the product's turnaround in ms; passing it
   turns the clock red once the order runs past it. */
export function Stopwatch({ startedAt, stoppedAt, target, className = "", size = "sm" }) {
  const ms = useElapsed(startedAt, stoppedAt);
  const over = target != null && ms > target;
  const tone = stoppedAt
    ? (over ? "text-amber-400" : "text-emerald-400")
    : (over ? "text-rose-400" : "text-slate-300");
  const type = size === "lg" ? "text-3xl" : size === "md" ? "text-lg" : "text-xs";
  return (
    <span className={`font-mono tabular-nums ${type} ${tone} ${className}`}
      title={stoppedAt ? "Time this order took" : "Running since the payment came in"}>
      {clock(ms)}
    </span>
  );
}
