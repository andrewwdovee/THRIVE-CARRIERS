/**
 * The Onboarding tab, spliced into the Lead Tech Fulfillment bundle by
 * patch-onboarding.mjs.
 *
 * There is no source for that board — only the built bundle — so this is
 * written the way the bundle itself is: jsx-runtime calls rather than JSX,
 * and the bundle's own React and storage objects rather than imports. The
 * four __TOKENS__ are replaced with the minified names the patch script
 * finds in the bundle it is patching, so a rebuild that renames them is
 * caught instead of silently producing a broken tab.
 *
 *   __JSX__    the jsx runtime      (l.jsx, l.jsxs, l.Fragment)
 *   __REACT__  React                (useState, useEffect, ...)
 *   __STORE__  the board's storage  (get/set/subscribe, relay or local)
 *   __URL__    the public onboarding page, as a JSON string
 *
 * Every Tailwind class used here is checked against the bundle's compiled
 * stylesheet at patch time. Tailwind only emits the classes that existed
 * when the board was built, so a class invented here would silently do
 * nothing.
 */

const OB_URL = __URL__;
const OB_KEY = "onboarding/submissions";
const OB_DOC = "onboarding/doc/";

/* The steps the grid ticks, left to right. `photo` is null rather than
   false for an outside agency: not missing, not required. */
const OB_STEPS = [
  ["details", "Details"],
  ["agreed", "LT read"],
  ["signed", "LT signed"],
  ["thriveRead", "TC read"],
  ["thriveSigned", "TC signed"],
  ["photo", "Photo"],
];

function ObIcon(p) {
  return __JSX__.jsxs("svg", Object.assign({}, p, {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      __JSX__.jsx("path", { d: "M15 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6z" }, "a"),
      __JSX__.jsx("path", { d: "M15 2v4h4" }, "b"),
      __JSX__.jsx("path", { d: "m9 14 2 2 4-4" }, "c"),
    ],
  }));
}

function obWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ObTick(props) {
  const v = props.on;
  if (v === null || v === undefined) {
    return __JSX__.jsx("span", {
      className: "text-slate-500 dark:text-slate-400",
      title: "Optional — not given",
      children: "–",
    });
  }
  return __JSX__.jsx("span", {
    className: v
      ? "text-emerald-600 dark:text-emerald-400 font-semibold"
      : "text-rose-600 dark:text-rose-400 font-semibold",
    children: v ? "✓" : "✕",
  });
}

function ObStat(props) {
  return __JSX__.jsxs("div", {
    className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3",
    children: [
      __JSX__.jsx("div", {
        className: "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400",
        children: props.label,
      }),
      __JSX__.jsx("div", {
        className: "text-2xl font-bold tabular-nums text-slate-900 dark:text-white",
        children: props.value,
      }),
    ],
  });
}

function ObPanel() {
  const [rows, setRows] = __REACT__.useState(null);
  const [err, setErr] = __REACT__.useState("");
  const [busy, setBusy] = __REACT__.useState(false);
  const [open, setOpen] = __REACT__.useState(null);
  const [doc, setDoc] = __REACT__.useState(null);
  const [copied, setCopied] = __REACT__.useState(false);
  const [pdfBusy, setPdfBusy] = __REACT__.useState("");
  const [pdfErr, setPdfErr] = __REACT__.useState("");
  const [q, setQ] = __REACT__.useState("");

  const load = __REACT__.useCallback(async () => {
    setBusy(true);
    try {
      const hit = await __STORE__.get(OB_KEY);
      let v = [];
      if (hit && hit.value) { try { v = JSON.parse(hit.value); } catch { v = []; } }
      setRows(Array.isArray(v) ? v : []);
      setErr("");
    } catch (e) {
      setRows([]);
      setErr(String((e && e.message) || e));
    }
    setBusy(false);
  }, []);

  __REACT__.useEffect(() => { load(); }, [load]);
  __REACT__.useEffect(() => __STORE__.subscribe(OB_KEY, load), [load]);

  const list = rows || [];
  const week = Date.now() - 7 * 864e5;
  const signedThisWeek = list.filter((r) => new Date(r.signedAt).getTime() >= week).length;
  const waiting = list.filter((r) => !r.reviewed).length;
  const withPhoto = list.filter((r) => (r.steps || {}).photo === true).length;
  /* The search box: any word of the name, business, email or start time. */
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((r) => [r.legalName, r.business, r.email, r.startTime]
        .some((v) => String(v || "").toLowerCase().includes(needle)))
    : list;

  async function openRow(id) {
    if (open === id) { setOpen(null); setDoc(null); return; }
    setOpen(id); setDoc(null);
    try {
      const hit = await __STORE__.get(OB_DOC + id);
      setDoc(hit && hit.value ? JSON.parse(hit.value) : null);
    } catch { setDoc(null); }
  }

  async function write(next) {
    setRows(next);
    try { await __STORE__.set(OB_KEY, JSON.stringify(next)); setErr(""); }
    catch (e) { setErr("That did not save: " + String((e && e.message) || e)); }
  }

  function toggleReviewed(id) {
    write(list.map((r) => (r.id === id ? Object.assign({}, r, { reviewed: !r.reviewed }) : r)));
  }

  function removeRow(id, name) {
    if (!window.confirm("Remove " + (name || "this submission") + " from the list?\n\nThe signed agreement itself is kept.")) return;
    if (open === id) { setOpen(null); setDoc(null); }
    write(list.filter((r) => r.id !== id));
  }

  function copyLink() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    try {
      navigator.clipboard.writeText(OB_URL).then(done, fallback);
    } catch { fallback(); }
    function fallback() {
      const el = document.getElementById("obUrlField");
      if (!el) return;
      el.focus(); el.select();
      try { document.execCommand("copy"); done(); } catch { /* let them copy it themselves */ }
    }
  }

  const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const cell = "px-3 py-2 text-sm text-slate-900 dark:text-white";
  const btn = "rounded-md border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800";

  /* ---------------------------------------------------------- the link */
  const linkCard = __JSX__.jsxs("div", {
    className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-3",
    children: [
      __JSX__.jsx("h3", {
        className: "text-sm font-semibold text-slate-900 dark:text-white",
        children: "The onboarding link",
      }),
      __JSX__.jsx("p", {
        className: "text-sm text-slate-600 dark:text-slate-300 mt-1 mb-3",
        children: "Send this to anyone being onboarded. They read the agreement, sign it, and land in the list below.",
      }),
      __JSX__.jsxs("div", {
        className: "flex items-center gap-2 flex-wrap",
        children: [
          __JSX__.jsx("input", {
            id: "obUrlField", readOnly: true, value: OB_URL,
            onFocus: (e) => e.target.select(),
            className: "flex-1 min-w-0 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono text-slate-900 dark:text-white",
          }, "u"),
          __JSX__.jsx("button", {
            onClick: copyLink, className: btn,
            children: copied ? "Copied" : "Copy",
          }, "c"),
          __JSX__.jsx("a", {
            href: OB_URL, target: "_blank", rel: "noreferrer", className: btn,
            children: "Open",
          }, "o"),
        ],
      }),
    ],
  });

  /* --------------------------------------------------------- the stats */
  const stats = __JSX__.jsxs("div", {
    className: "grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3",
    children: [
      __JSX__.jsx(ObStat, { label: "Signed", value: list.length }, "a"),
      __JSX__.jsx(ObStat, { label: "This week", value: signedThisWeek }, "b"),
      __JSX__.jsx(ObStat, { label: "Not yet reviewed", value: waiting }, "c"),
      __JSX__.jsx(ObStat, { label: "Photo on file", value: withPhoto }, "d"),
    ],
  });

  /* A copy of the agreement as signed, built here rather than fetched:
     the text, the typed name, the date and the signature image. The two
     agreements are separate documents and download separately. */
  function savePdf(rec, which) {
    setPdfErr("");
    setPdfBusy(which);
    obContractPdf(rec, which).then(function (out) {
      return obDownload(out);
    }).then(function () {
      setPdfBusy("");
    }).catch(function (e) {
      setPdfBusy("");
      setPdfErr("Could not build that PDF: " + (e && e.message ? e.message : String(e)));
    });
  }

  /* The headshot comes down the same way the agreements do. It is stored
     as a data URL, so it is turned back into a file here. */
  function savePhoto(rec) {
    setPdfErr("");
    try {
      const m = String(rec.photo || "").match(/^data:([^;,]+)(;base64)?,(.*)$/);
      if (!m) throw new Error("the photo on file is not readable");
      const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
      const name = String(rec.legalName || "agent").trim().replace(/[^\w .-]+/g, "").replace(/\s+/g, " ");
      Promise.resolve(__SAVE__(name + " headshot." + ext, new Blob([bytes], { type: m[1] })))
        .then(function (r) {
          if (r && r.ok === false) setPdfErr("Could not save the photo: " + obSaveWhy(r.code));
        })
        .catch(function (e) { setPdfErr("Could not save the photo: " + (e && e.message ? e.message : String(e))); });
    } catch (e) {
      setPdfErr("Could not save the photo: " + (e && e.message ? e.message : String(e)));
    }
  }

  /* ------------------------------------------------------ one open row */
  function detail(r) {
    if (!doc) {
      return __JSX__.jsx("td", {
        colSpan: OB_STEPS.length + 4,
        className: "px-3 py-3 text-sm text-slate-500 dark:text-slate-400",
        children: "Opening the signed agreement…",
      });
    }
    const pair = (k, v) => __JSX__.jsxs("div", {
      children: [
        __JSX__.jsx("div", { className: "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400", children: k }, "k"),
        __JSX__.jsx("div", { className: "text-sm text-slate-900 dark:text-white", children: v || "—" }, "v"),
      ],
    }, k);
    return __JSX__.jsx("td", {
      colSpan: OB_STEPS.length + 4,
      className: "px-3 py-4 bg-slate-50 dark:bg-slate-950",
      children: __JSX__.jsxs("div", {
        className: "grid gap-4",
        children: [
          __JSX__.jsxs("div", {
            className: "grid grid-cols-2 lg:grid-cols-4 gap-3",
            children: [
              pair("Email", doc.email), pair("Phone", doc.phone),
              pair("NPN", doc.npn), pair("Brought in by", doc.referrer),
              pair("Calls start", doc.startTime), pair("Dated", doc.signedDate),
              pair("Agreement", doc.version), pair("Signed at", obWhen(doc.signedAt)),
            ],
          }, "f"),
          __JSX__.jsxs("div", {
            className: "flex gap-4 flex-wrap items-center",
            children: [
              ...[["Lead Tech agreement", doc.signature, doc.signedName, doc.signedDate],
                  ["Thrive Companies agreement", doc.thriveSignature, doc.thriveSignedName, doc.thriveSignedDate]]
                .map(([what, png, who, when]) => __JSX__.jsxs("div", {
                  children: [
                    __JSX__.jsx("div", { className: "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1", children: what }, "l"),
                    png
                      ? __JSX__.jsx("img", {
                          src: png, alt: "Signature of " + (who || ""),
                          style: { height: "64px", background: "#fff", borderRadius: "6px", padding: "4px" },
                        }, "i")
                      : __JSX__.jsx("div", { className: "text-sm text-slate-500 dark:text-slate-400", children: "not signed" }, "i"),
                    __JSX__.jsxs("div", {
                      className: "text-xs text-slate-500 dark:text-slate-400 mt-1",
                      children: ["Typed as ", who || "—", when ? " · " + when : ""],
                    }, "s"),
                  ],
                }, what)),
              doc.photo && __JSX__.jsxs("div", {
                children: [
                  __JSX__.jsx("div", { className: "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1", children: "Headshot photo" }, "l"),
                  __JSX__.jsx("img", {
                    src: doc.photo, alt: "",
                    style: { height: "96px", width: "96px", objectFit: "cover", borderRadius: "999px" },
                  }, "i"),
                ],
              }, "ph"),
            ],
          }, "m"),
          __JSX__.jsxs("div", {
            className: "flex gap-2 flex-wrap items-center",
            children: [
              ...[["lt", "Lead Tech contract", doc.signature],
                  ["tc", "Thrive contract", doc.thriveSignature]]
                .map(([which, label, png]) => __JSX__.jsx("button", {
                  type: "button",
                  className: btn,
                  disabled: !png || pdfBusy !== "",
                  onClick: () => savePdf(doc, which),
                  children: pdfBusy === which ? "Building the PDF…" : "Download " + label + " (PDF)",
                }, which)),
              __JSX__.jsx("button", {
                type: "button",
                className: btn,
                disabled: !doc.photo,
                title: doc.photo ? "" : "No headshot was uploaded",
                onClick: () => savePhoto(doc),
                children: doc.photo ? "Download headshot photo" : "No headshot uploaded",
              }, "ph"),
              pdfErr && __JSX__.jsx("span", {
                className: "text-sm text-rose-600 dark:text-rose-400",
                children: pdfErr,
              }, "e"),
            ],
          }, "d"),
        ],
      }),
    });
  }

  /* --------------------------------------------------------- the grid */
  let body;
  if (rows === null) {
    body = __JSX__.jsx("p", {
      className: "text-sm text-slate-500 dark:text-slate-400",
      children: "Reading the list…",
    });
  } else if (!list.length) {
    body = __JSX__.jsxs("div", {
      className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4",
      children: [
        __JSX__.jsx("p", { className: "text-sm font-semibold text-slate-900 dark:text-white", children: "Nobody has signed yet." }, "a"),
        __JSX__.jsx("p", { className: "text-sm text-slate-600 dark:text-slate-300 mt-1", children: "Send the link above. Signed agreements show up here on their own." }, "b"),
      ],
    });
  } else {
    body = __JSX__.jsx("div", {
      className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto",
      children: __JSX__.jsxs("table", {
        className: "w-full",
        children: [
          __JSX__.jsx("thead", {
            children: __JSX__.jsxs("tr", {
              className: "border-b border-slate-200 dark:border-slate-800",
              children: [
                __JSX__.jsx("th", { className: head, children: "Who" }, "w"),
                ...OB_STEPS.map(([k, label]) =>
                  __JSX__.jsx("th", { className: head + " text-center", children: label }, k)),
                __JSX__.jsx("th", { className: head, children: "When" }, "s"),
                __JSX__.jsx("th", { className: head + " text-center", children: "Reviewed" }, "r"),
                __JSX__.jsx("th", { className: head }, "x"),
              ],
            }),
          }, "h"),
          __JSX__.jsx("tbody", {
            children: shown.map((r) => __JSX__.jsxs(__JSX__.Fragment, {
              children: [
                __JSX__.jsxs("tr", {
                  className: "border-b border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer",
                  onClick: () => openRow(r.id),
                  children: [
                    __JSX__.jsxs("td", {
                      className: cell,
                      children: [
                        __JSX__.jsx("div", { className: "font-semibold truncate", children: r.legalName || "—" }, "n"),
                        __JSX__.jsxs("div", {
                          className: "text-xs text-slate-500 dark:text-slate-400 truncate",
                          children: [r.business || "", r.startTime ? " · starts " + r.startTime : ""],
                        }, "b"),
                      ],
                    }, "w"),
                    ...OB_STEPS.map(([k]) => __JSX__.jsx("td", {
                      className: cell + " text-center",
                      children: __JSX__.jsx(ObTick, { on: (r.steps || {})[k] }),
                    }, k)),
                    __JSX__.jsx("td", {
                      className: cell + " text-slate-600 dark:text-slate-300",
                      children: obWhen(r.signedAt),
                    }, "s"),
                    __JSX__.jsx("td", {
                      className: cell + " text-center",
                      children: __JSX__.jsx("input", {
                        type: "checkbox", checked: !!r.reviewed,
                        onClick: (e) => e.stopPropagation(),
                        onChange: () => toggleReviewed(r.id),
                        "aria-label": "Reviewed " + (r.legalName || ""),
                      }),
                    }, "r"),
                    __JSX__.jsx("td", {
                      className: cell + " text-right",
                      children: __JSX__.jsx("button", {
                        className: "text-xs font-medium text-rose-600 dark:text-rose-400",
                        onClick: (e) => { e.stopPropagation(); removeRow(r.id, r.legalName); },
                        children: "Remove",
                      }),
                    }, "x"),
                  ],
                }, "r"),
                open === r.id && __JSX__.jsx("tr", {
                  className: "border-b border-slate-200 dark:border-slate-800",
                  children: detail(r),
                }, "d"),
              ],
            }, r.id)),
          }, "b"),
        ],
      }),
    });
  }

  return __JSX__.jsxs("div", {
    children: [
      linkCard,
      stats,
      err && __JSX__.jsx("div", {
        className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 mb-3 text-sm text-rose-600 dark:text-rose-400",
        children: err,
      }, "e"),
      __JSX__.jsxs("div", {
        className: "flex items-center justify-between gap-2 mb-2",
        children: [
          __JSX__.jsx("h3", {
            className: "text-sm font-semibold text-slate-900 dark:text-white",
            children: "Who has signed",
          }, "t"),
          __JSX__.jsxs("div", {
            className: "flex items-center gap-2",
            children: [
              __JSX__.jsx("input", {
                type: "search", value: q, placeholder: "Search by name, business or email",
                "aria-label": "Search who has signed",
                onChange: (e) => setQ(e.target.value),
                className: "w-full min-w-0 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-white",
                style: { width: "260px", maxWidth: "60vw" },
              }, "q"),
              __JSX__.jsx("button", {
                onClick: load, disabled: busy, className: btn + " disabled:opacity-60",
                children: busy ? "Refreshing" : "Refresh",
              }, "r"),
            ],
          }, "tools"),
        ],
      }, "hd"),
      needle && list.length && !shown.length
        ? __JSX__.jsx("div", {
            className: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300",
            children: "Nobody who has signed matches \u201c" + q.trim() + "\u201d.",
          }, "none")
        : body,
    ],
  });
}
