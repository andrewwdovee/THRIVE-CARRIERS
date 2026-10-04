/**
 * The Start times tab, spliced into the Lead Tech Fulfillment bundle by
 * patch-onboarding.mjs. Same rules as onboarding-tab.js: jsx-runtime calls
 * rather than JSX, the bundle's own React and storage, __TOKENS__ replaced
 * with the minified names found in the bundle being patched, and every
 * Tailwind class checked against the compiled stylesheet.
 *
 * What it is for. Everyone who signed the onboarding form picked 10:00 or
 * 11:00. If they are not on fifteen minutes after that, their calls go off
 * for the day and back on that night. This tab is the list to work down in
 * the morning, the list to undo in the evening, and the record of who keeps
 * ending up on it.
 */

const ST_KEY = "starttimes/state";
/* The settings page ships inside the onboarding deploy, so it is that
   URL with /start-time on the end. */
const ST_URL = String(__URL__).replace(/\/+$/, "") + "/start-time";
const ST_SLOTS = ["10:00 AM EST", "11:00 AM EST"];
const ST_GRACE = 15;            /* minutes after the start time */

/* One series, so the colour job is magnitude, not identity: the default
   sequential blue, stepped for each surface. Both steps clear the 3:1
   contrast gate against the surface they sit on. */
const ST_BAR = { light: "#2a78d6", dark: "#3987e5" };

function StIcon(p) {
  return __JSX__.jsxs("svg", Object.assign({}, p, {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      __JSX__.jsx("circle", { cx: "12", cy: "12", r: "9" }, "a"),
      __JSX__.jsx("path", { d: "M12 7v5l3 2" }, "b"),
    ],
  }));
}

function stToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

function stDayLabel(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/* "Dana Whitfield" -> first Dana, last Whitfield. The form takes one legal
   name, so the split is the first word and the rest; a one-word name has no
   surname rather than a wrong one. */
function stSplitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/* The cut-off: fifteen past whichever hour they chose, as plain text. */
function stCutoff(slot) {
  const m = String(slot).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return "";
  const mins = (+m[2] + ST_GRACE) % 60;
  const carry = (+m[2] + ST_GRACE) >= 60 ? 1 : 0;
  let hr = (+m[1] + carry);
  if (hr > 12) hr -= 12;
  return hr + ":" + String(mins).padStart(2, "0") + " " + m[3].toUpperCase();
}

/* Dark mode is a class on <html>, and this tab paints one mark in code
   rather than through a stylesheet, so it has to watch for the toggle. */
function stUseDark() {
  const [dark, setDark] = __REACT__.useState(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  __REACT__.useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setDark(el.classList.contains("dark")));
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function StPanel() {
  const [rows, setRows] = __REACT__.useState(null);
  const [state, setState] = __REACT__.useState({ off: {}, log: [] });
  const [err, setErr] = __REACT__.useState("");
  const [busy, setBusy] = __REACT__.useState(false);
  const [window30, setWindow30] = __REACT__.useState(true);
  const [copied, setCopied] = __REACT__.useState(false);
  const dark = stUseDark();
  const today = stToday();

  const load = __REACT__.useCallback(async () => {
    setBusy(true);
    try {
      const [a, b] = await Promise.all([
        __STORE__.get("onboarding/submissions"),
        __STORE__.get(ST_KEY),
      ]);
      let list = [];
      if (a && a.value) { try { list = JSON.parse(a.value); } catch { list = []; } }
      let st = { off: {}, log: [] };
      if (b && b.value) { try { st = JSON.parse(b.value); } catch { st = { off: {}, log: [] }; } }
      setRows(Array.isArray(list) ? list : []);
      setState({ off: st.off || {}, log: Array.isArray(st.log) ? st.log : [] });
      setErr("");
    } catch (e) {
      setRows([]);
      setErr(String((e && e.message) || e));
    }
    setBusy(false);
  }, []);

  __REACT__.useEffect(() => { load(); }, [load]);
  __REACT__.useEffect(() => __STORE__.subscribe(ST_KEY, load), [load]);
  __REACT__.useEffect(() => __STORE__.subscribe("onboarding/submissions", load), [load]);

  /* One row per person. Signing twice replaces the earlier answer rather
     than putting them on the board twice. */
  const people = __REACT__.useMemo(() => {
    const seen = new Map();
    (rows || []).forEach((r) => {
      const email = String(r.email || "").toLowerCase();
      if (!email) return;
      const prev = seen.get(email);
      if (prev && new Date(prev.signedAt) >= new Date(r.signedAt)) return;
      const nm = stSplitName(r.legalName);
      seen.set(email, {
        email, first: nm.first, last: nm.last, name: r.legalName || email,
        startTime: r.startTime || "", signedAt: r.signedAt,
        callsPerWeek: r.callsPerWeek, note: r.note || "", prefsUpdatedAt: r.prefsUpdatedAt || "",
        busyDays: Array.isArray(r.busyDays) ? r.busyDays : [], busyPart: r.busyPart || "",
      });
    });
    return [...seen.values()].sort((a, b) =>
      (a.last || a.first).localeCompare(b.last || b.first));
  }, [rows]);

  async function write(next) {
    setState(next);
    try { await __STORE__.set(ST_KEY, JSON.stringify(next)); setErr(""); }
    catch (e) { setErr("That did not save: " + String((e && e.message) || e)); }
  }

  function switchOff(p) {
    if (state.off[p.email]) return;
    const at = new Date().toISOString();
    write({
      off: Object.assign({}, state.off, { [p.email]: { date: today, at } }),
      log: [{ email: p.email, name: p.name, date: today, offAt: at, onAt: null }].concat(state.log),
    });
  }

  function switchOn(p) {
    if (!state.off[p.email]) return;
    const off = Object.assign({}, state.off);
    delete off[p.email];
    const at = new Date().toISOString();
    let closed = false;
    const log = state.log.map((e) => {
      if (closed || e.email !== p.email || e.onAt) return e;
      closed = true;
      return Object.assign({}, e, { onAt: at });
    });
    write({ off, log });
  }

  function allBackOn() {
    const emails = Object.keys(state.off);
    if (!emails.length) return;
    if (!window.confirm("Turn calls back on for all " + emails.length + "?")) return;
    const at = new Date().toISOString();
    const done = {};
    const log = state.log.map((e) => {
      if (e.onAt || done[e.email] || !state.off[e.email]) return e;
      done[e.email] = true;
      return Object.assign({}, e, { onAt: at });
    });
    write({ off: {}, log });
  }

  function copyLink() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    const fallback = () => {
      const el = document.getElementById("stUrlField");
      if (!el) return;
      el.focus(); el.select();
      try { document.execCommand("copy"); done(); } catch { /* let them copy it */ }
    };
    try { navigator.clipboard.writeText(ST_URL).then(done, fallback); } catch { fallback(); }
  }

  const offCount = Object.keys(state.off).length;
  const stale = Object.keys(state.off).filter((e) => state.off[e].date !== today).length;

  /* ------------------------------------------------- how often, by person */
  const tally = __REACT__.useMemo(() => {
    const from = window30 ? Date.now() - 30 * 864e5 : 0;
    const by = new Map();
    state.log.forEach((e) => {
      if (new Date(e.offAt).getTime() < from) return;
      const k = String(e.email || "").toLowerCase();
      const hit = by.get(k) || { email: k, name: e.name || k, n: 0, last: e.offAt };
      hit.n += 1;
      if (new Date(e.offAt) > new Date(hit.last)) hit.last = e.offAt;
      by.set(k, hit);
    });
    return [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 12);
  }, [state.log, window30]);

  const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const cell = "px-3 py-2 text-sm text-slate-900 dark:text-white";
  const btn = "rounded-md border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800";
  const card = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900";

  /* --------------------------------------------------------- the link */
  const linkCard = __JSX__.jsxs("div", {
    className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-3",
    children: [
      __JSX__.jsx("h3", {
        className: "text-sm font-semibold text-slate-900 dark:text-white",
        children: "The settings link",
      }, "a"),
      __JSX__.jsx("p", {
        className: "text-sm text-slate-600 dark:text-slate-300 mt-1 mb-3",
        children: "Anyone can open this and change their own start time, how many calls they want a week, and leave the desk a note. Add ?email= to land them on their own row.",
      }, "b"),
      __JSX__.jsxs("div", {
        className: "flex items-center gap-2 flex-wrap",
        children: [
          __JSX__.jsx("input", {
            id: "stUrlField", readOnly: true, value: ST_URL,
            onFocus: (e) => e.target.select(),
            className: "flex-1 min-w-0 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono text-slate-900 dark:text-white",
          }, "u"),
          __JSX__.jsx("button", { onClick: copyLink, className: btn, children: copied ? "Copied" : "Copy" }, "c"),
          __JSX__.jsx("a", {
            href: ST_URL, target: "_blank", rel: "noreferrer", className: btn, children: "Open",
          }, "o"),
        ],
      }, "r"),
    ],
  });

  /* ------------------------------------------------------------ the day */
  const banner = __JSX__.jsxs("div", {
    className: card + " p-4 mb-3 flex items-center justify-between gap-3 flex-wrap",
    children: [
      __JSX__.jsxs("div", {
        children: [
          __JSX__.jsx("h3", {
            className: "text-sm font-semibold text-slate-900 dark:text-white",
            children: offCount
              ? offCount + (offCount === 1 ? " account is off" : " accounts are off")
              : "Everyone is on",
          }, "a"),
          __JSX__.jsx("p", {
            className: "text-sm text-slate-600 dark:text-slate-300 mt-1",
            children: offCount
              ? (stale
                  ? stale + " of them from a day before today — those have not been turned back on."
                  : "Turn them back on tonight so they can take calls tomorrow.")
              : "Switch off anyone who is not on fifteen minutes after their start time.",
          }, "b"),
        ],
      }, "t"),
      __JSX__.jsx("button", {
        onClick: allBackOn, disabled: !offCount,
        className: btn + " disabled:opacity-60",
        children: "Turn everyone back on",
      }, "r"),
    ],
  });

  /* --------------------------------------------------------- the groups */
  function group(slot) {
    const mine = people.filter((p) => p.startTime === slot);
    const offHere = mine.filter((p) => state.off[p.email]).length;
    return __JSX__.jsxs("div", {
      className: card + " overflow-x-auto",
      children: [
        __JSX__.jsxs("div", {
          className: "px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap",
          children: [
            __JSX__.jsxs("div", {
              children: [
                __JSX__.jsx("h3", { className: "text-sm font-semibold text-slate-900 dark:text-white", children: slot }, "a"),
                __JSX__.jsxs("p", {
                  className: "text-xs text-slate-500 dark:text-slate-400 mt-1",
                  children: ["Off at ", stCutoff(slot), " if they are not on"],
                }, "b"),
              ],
            }, "h"),
            __JSX__.jsxs("span", {
              className: "text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums",
              children: [mine.length - offHere, " on · ", offHere, " off"],
            }, "c"),
          ],
        }, "hd"),
        mine.length
          ? __JSX__.jsxs("table", {
              className: "w-full",
              children: [
                __JSX__.jsx("thead", {
                  children: __JSX__.jsxs("tr", {
                    className: "border-b border-slate-200 dark:border-slate-800",
                    children: [
                      __JSX__.jsx("th", { className: head, children: "First" }, "f"),
                      __JSX__.jsx("th", { className: head, children: "Last" }, "l"),
                      __JSX__.jsx("th", { className: head, children: "Email" }, "e"),
                      __JSX__.jsx("th", { className: head + " text-right", children: "Per wk" }, "w"),
                      __JSX__.jsx("th", { className: head + " text-right", children: "Calls" }, "c"),
                    ],
                  }),
                }, "th"),
                __JSX__.jsx("tbody", {
                  children: mine.map((p) => {
                    const off = state.off[p.email];
                    return __JSX__.jsxs("tr", {
                      className: "border-b border-slate-200 dark:border-slate-800",
                      children: [
                        __JSX__.jsx("td", { className: cell + " font-semibold", children: p.first || "—" }, "f"),
                        __JSX__.jsx("td", { className: cell, children: p.last || "—" }, "l"),
                        __JSX__.jsxs("td", {
                          className: cell + " text-slate-600 dark:text-slate-300",
                          children: [
                            __JSX__.jsx("div", { className: "truncate", children: p.email }, "a"),
                            p.busyDays.length ? __JSX__.jsxs("div", {
                              className: "text-xs text-amber-600 dark:text-amber-400 truncate",
                              children: ["Busy ", p.busyDays.join(", "), p.busyPart ? " · " + p.busyPart : ""],
                            }, "b") : null,
                            p.note ? __JSX__.jsx("div", {
                              className: "text-xs text-slate-500 dark:text-slate-400 truncate",
                              title: p.note,
                              children: "“" + p.note + "”",
                            }, "n") : null,
                          ],
                        }, "e"),
                        __JSX__.jsx("td", {
                          className: cell + " text-right tabular-nums text-slate-600 dark:text-slate-300",
                          children: p.callsPerWeek == null || p.callsPerWeek === "" ? "—" : p.callsPerWeek,
                        }, "w"),
                        __JSX__.jsx("td", {
                          className: cell + " text-right",
                          children: __JSX__.jsxs("span", {
                            className: "inline-flex items-center gap-2",
                            children: [
                              off && __JSX__.jsxs("span", {
                                className: "text-xs text-slate-500 dark:text-slate-400",
                                style: { whiteSpace: "nowrap" },
                                children: ["off ", off.date === today ? stTime(off.at) : stDayLabel(off.date)],
                              }, "w"),
                              __JSX__.jsx("button", {
                                onClick: () => (off ? switchOn(p) : switchOff(p)),
                                className: off
                                  ? "rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                                  : btn + " text-xs",
                                children: off ? "Turn back on" : "Switch off",
                              }, "b"),
                            ],
                          }),
                        }, "c"),
                      ],
                    }, p.email);
                  }),
                }, "tb"),
              ],
            })
          : __JSX__.jsx("p", {
              className: "px-4 py-4 text-sm text-slate-500 dark:text-slate-400",
              children: "Nobody has picked this time yet.",
            }, "empty"),
      ],
    }, slot);
  }

  const unslotted = people.filter((p) => ST_SLOTS.indexOf(p.startTime) < 0);

  /* ------------------------------------------------------------- figure */
  const worst = tally.length ? tally[0].n : 0;
  const chart = __JSX__.jsxs("div", {
    className: card + " p-4 mt-3",
    children: [
      __JSX__.jsxs("div", {
        className: "flex items-center justify-between gap-2 flex-wrap mb-3",
        children: [
          __JSX__.jsxs("div", {
            children: [
              __JSX__.jsx("h3", {
                className: "text-sm font-semibold text-slate-900 dark:text-white",
                children: "Switched off most often",
              }, "a"),
              __JSX__.jsx("p", {
                className: "text-xs text-slate-500 dark:text-slate-400 mt-1",
                children: "Days their calls were turned off, most to least.",
              }, "b"),
            ],
          }, "t"),
          __JSX__.jsxs("span", {
            className: "inline-flex items-center gap-1",
            children: [
              __JSX__.jsx("button", {
                onClick: () => setWindow30(true),
                className: window30
                  ? "rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                  : btn + " text-xs",
                children: "Last 30 days",
              }, "a"),
              __JSX__.jsx("button", {
                onClick: () => setWindow30(false),
                className: !window30
                  ? "rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                  : btn + " text-xs",
                children: "All time",
              }, "b"),
            ],
          }, "f"),
        ],
      }, "hd"),
      tally.length
        ? __JSX__.jsx("div", {
            className: "grid gap-2",
            children: tally.map((t) => __JSX__.jsxs("div", {
              className: "grid items-center gap-3",
              style: { gridTemplateColumns: "minmax(0,11rem) 1fr auto" },
              title: t.name + " — " + t.n + (t.n === 1 ? " day" : " days") +
                ", most recently " + stDayLabel(String(t.last).slice(0, 10)),
              children: [
                __JSX__.jsx("span", {
                  className: "text-sm text-slate-900 dark:text-white truncate",
                  children: t.name,
                }, "n"),
                __JSX__.jsx("span", {
                  style: { display: "block", height: "14px" },
                  children: __JSX__.jsx("span", {
                    style: {
                      display: "block", height: "14px",
                      width: Math.max(2, (t.n / worst) * 100) + "%",
                      background: dark ? ST_BAR.dark : ST_BAR.light,
                      borderRadius: "0 4px 4px 0",
                    },
                  }),
                }, "b"),
                __JSX__.jsx("span", {
                  className: "text-sm font-semibold tabular-nums text-slate-900 dark:text-white",
                  children: t.n,
                }, "v"),
              ],
            }, t.email)),
          })
        : __JSX__.jsx("p", {
            className: "text-sm text-slate-500 dark:text-slate-400",
            children: window30
              ? "Nobody has been switched off in the last 30 days."
              : "Nobody has been switched off yet.",
          }, "empty"),
    ],
  });

  if (rows === null) {
    return __JSX__.jsx("p", {
      className: "text-sm text-slate-500 dark:text-slate-400",
      children: "Reading the list…",
    });
  }

  if (!people.length) {
    return __JSX__.jsxs("div", {
      className: card + " p-4",
      children: [
        __JSX__.jsx("p", { className: "text-sm font-semibold text-slate-900 dark:text-white", children: "Nobody has onboarded yet." }, "a"),
        __JSX__.jsx("p", { className: "text-sm text-slate-600 dark:text-slate-300 mt-1", children: "Start times come from the onboarding form, on the tab before this one." }, "b"),
      ],
    });
  }

  return __JSX__.jsxs("div", {
    children: [
      linkCard,
      banner,
      err && __JSX__.jsx("div", {
        className: card + " px-4 py-3 mb-3 text-sm text-rose-600 dark:text-rose-400",
        children: err,
      }, "e"),
      __JSX__.jsxs("div", {
        className: "flex items-center justify-between gap-2 mb-2",
        children: [
          __JSX__.jsx("h3", {
            className: "text-sm font-semibold text-slate-900 dark:text-white",
            children: "Who starts when",
          }, "t"),
          __JSX__.jsx("button", {
            onClick: load, disabled: busy, className: btn + " disabled:opacity-60",
            children: busy ? "Refreshing" : "Refresh",
          }, "r"),
        ],
      }, "hd"),
      __JSX__.jsx("div", {
        className: "grid lg:grid-cols-2 gap-3",
        children: ST_SLOTS.map(group),
      }, "g"),
      unslotted.length ? __JSX__.jsxs("div", {
        className: card + " p-4 mt-3",
        children: [
          __JSX__.jsx("h3", { className: "text-sm font-semibold text-slate-900 dark:text-white", children: "No start time on file" }, "a"),
          __JSX__.jsx("p", {
            className: "text-sm text-slate-600 dark:text-slate-300 mt-1",
            children: unslotted.map((p) => p.name).join(", "),
          }, "b"),
        ],
      }, "u") : null,
      chart,
    ],
  });
}
