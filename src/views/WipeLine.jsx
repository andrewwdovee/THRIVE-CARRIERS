import React, { useState, useMemo } from "react";
import { M, F, W, BD, cash, weekLabel } from "../lib/shared";

/* Money wiped, week by week.

   One series over time, so: a line, no legend — the heading names it — and a
   crosshair that reads the value under the pointer rather than printing a
   number on every point. Positions are proportional to the date, not to
   position in the list, so a week nobody entered shows as the gap it is
   instead of being quietly closed up. */

const VB = { w: 760, h: 210 };
const PAD = { l: 58, r: 14, t: 14, b: 30 };
const PLOT = { w: VB.w - PAD.l - PAD.r, h: VB.h - PAD.t - PAD.b };

/* Round the top of the scale up to something a person would choose, so the
   gridline labels read $250 rather than $237.43. The ladder is fine-grained
   on purpose: jumping 1000 -> 2000 for a peak of 1050 throws away half the
   height of the chart. */
function niceTop(max) {
  if (max <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const top = step * pow;
    if (top >= max) return top;
  }
  return 10 * pow;
}

/* Axis money, not receipt money: no cents, and thousands folded once the
   numbers get long enough to crowd the plot. */
const axisMoney = (c) => {
  const d = c / 100;
  if (Math.abs(d) >= 10000) return `$${Math.round(d / 1000)}k`;
  return `$${Math.round(d).toLocaleString()}`;
};

/* Month and day only. The year is in the readout under the chart, and
   repeating it on every tick is what makes the labels collide. */
const tickLabel = (t) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* points: [{ at, value, note }] — at is a timestamp, value a number.
   money=false draws plain counts, for "orders placed per day". */
export default function WipeLine({ points, money = true, onPick, active, empty = "Nothing recorded yet." }) {
  const [hover, setHover] = useState(null);
  /* Loud rather than empty. Renaming this prop once left a call site passing
     the old name, and the chart drew a tidy "nothing recorded yet" over data
     that was right there — a blank chart looks like no data, not a bug. */
  if (points === undefined) throw new Error("WipeLine needs `points`; it was not passed one.");
  const weeks = points || [];

  const fmt = money ? (v) => cash(v) : (v) => String(Math.round(v));
  const axisFmt = money ? axisMoney : (v) => String(Math.round(v));

  const { pts, top, ticks } = useMemo(() => {
    if (!weeks.length) return { pts: [], top: 0, ticks: [] };
    const max = Math.max(...weeks.map((w) => w.value));
    const t = niceTop(max);
    const first = weeks[0].at, last = weeks[weeks.length - 1].at;
    const span = last - first;
    const pts = weeks.map((w, i) => ({
      ...w,
      /* A single point has no span to divide by; sit it in the middle. */
      x: PAD.l + (span ? ((w.at - first) / span) * PLOT.w : PLOT.w / 2),
      y: PAD.t + PLOT.h - (t ? (w.value / t) * PLOT.h : 0),
      i,
    }));
    /* Keep a label only when it clears the last one kept. Sampling every nth
       point looks even in the code and collides on screen, because the points
       aren't evenly spaced in time. The last week always gets a label, and
       whatever sat too close to it is dropped rather than overlapped. */
    const GAP = 62;
    const keep = [];
    for (const pt of pts) if (!keep.length || pt.x - keep[keep.length - 1].x >= GAP) keep.push(pt);
    const end = pts[pts.length - 1];
    if (keep[keep.length - 1] !== end) {
      while (keep.length && end.x - keep[keep.length - 1].x < GAP) keep.pop();
      keep.push(end);
    }
    return { pts, top: t, ticks: keep };
  }, [weeks]);

  if (!weeks.length) return <p className={`mt-3 text-sm ${F}`}>{empty}</p>;

  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${PAD.t + PLOT.h} L${pts[0].x.toFixed(1)},${PAD.t + PLOT.h} Z`;
  const grid = [0, 0.5, 1];
  const shown = hover ?? (active != null ? pts.find((p) => p.at === active) : null);

  /* The pointer is nowhere near a single point most of the time, so snap to
     the nearest one by x — a line chart you have to hit exactly is a line
     chart nobody hovers. */
  const nearest = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * VB.w;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best;
  };
  const track = (e) => setHover(nearest(e));

  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="w-full" style={{ height: 210 }}
        onMouseMove={track} onMouseLeave={() => setHover(null)}
        onClick={(e) => onPick?.(nearest(e).at)}
        role="img" aria-label={`${weekLabel(weeks[0].at)} to ${weekLabel(weeks[weeks.length - 1].at)}`}>

        {/* Recessive grid: there to be measured against, not looked at. */}
        {grid.map((g) => {
          const y = PAD.t + PLOT.h - g * PLOT.h;
          return (
            <g key={g}>
              <line x1={PAD.l} x2={VB.w - PAD.r} y1={y} y2={y}
                className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end"
                className="fill-slate-500 text-[10px] font-medium">{axisFmt(Math.round(top * g))}</text>
            </g>
          );
        })}

        <path d={area} className="fill-blue-500/10" />
        <path d={line} fill="none" className="stroke-blue-500" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />

        {pts.map((p) => (
          <circle key={p.at} cx={p.x} cy={p.y} r={shown?.at === p.at ? 5 : 3.5}
            className="fill-blue-500 stroke-white dark:stroke-slate-900" strokeWidth="2" />
        ))}

        {shown && (
          <line x1={shown.x} x2={shown.x} y1={PAD.t} y2={PAD.t + PLOT.h}
            className="stroke-slate-400 dark:stroke-slate-600" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {ticks.map((p) => (
          <text key={p.at} x={p.x} y={VB.h - 10}
            textAnchor={p.i === 0 ? "start" : p.i === pts.length - 1 ? "end" : "middle"}
            className="fill-slate-500 text-[10px]">{tickLabel(p.at)}</text>
        ))}
      </svg>

      {/* Read the value here rather than printing one on every point. */}
      <div className={`mt-1 flex flex-wrap items-baseline gap-x-2 text-sm ${shown ? "" : "opacity-0"}`} aria-live="polite">
        <span className={W}>{shown ? weekLabel(shown.at) : "—"}</span>
        <span className={`font-mono ${W}`}>{shown ? fmt(shown.value) : ""}</span>
        <span className={`text-xs ${F}`}>{shown?.note || ""}</span>
      </div>
    </div>
  );
}
