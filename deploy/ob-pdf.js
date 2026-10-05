/**
 * A PDF of a signed agreement, built in the browser with nothing loaded
 * from anywhere.
 *
 * The board is one self-contained file served from Pages, and the whole
 * point of the exercise is a copy of the contract somebody can keep, so
 * reaching for a CDN at the moment of download is the one thing that
 * must not happen. This writes the PDF by hand: base-14 Helvetica for
 * the text, the signature flattened onto white and embedded as a JPEG,
 * which PDF takes raw under /DCTDecode.
 *
 * What it produces is the agreement as signed, not a receipt about it:
 * the full text, then an execution block carrying the typed name, the
 * date, the signature image and the details the record was filed under.
 *
 * The text comes from onboarding/contract.md, inlined at patch time, so
 * the board cannot drift from the page people actually signed. Each
 * record stores the version it was signed under; if that is not the
 * version inlined here the PDF says so on its face rather than passing
 * off today's wording as what somebody agreed to.
 *
 *   __CONTRACT__  { version, entity, state, lt, tc }, as JSON
 *   __SAVE__      the board's own save-a-file helper, (filename, blob)
 */

var OB_CONTRACT = __CONTRACT__;

/* ------------------------------------------------------------ text */

/* Unicode that WinAnsi keeps in the 0x80-0x9F hole. Everything from
   0xA0 up already agrees with Latin-1, so it passes straight through. */
var OB_HOLE = {
  8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134,
  8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140,
  381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149,
  8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155,
  339: 156, 382: 158, 376: 159,
};

function obWin(s) {
  var o = "", i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 256) { o += s.charAt(i); continue; }
    o += OB_HOLE[c] ? String.fromCharCode(OB_HOLE[c]) : "?";
  }
  return o;
}

/* Advance widths, 1000 to the em, grouped by the width they share. */
var OB_WREG = {}, OB_WBOLD = {};
(function () {
  function load(into, spec) {
    for (var i = 0; i < spec.length; i += 2) {
      var chars = spec[i], w = spec[i + 1], j;
      for (j = 0; j < chars.length; j++) into[chars.charCodeAt(j)] = w;
    }
  }
  load(OB_WREG, [
    "\x92\x91", 222, "il", 222, "|", 260,
    " !,./:;Ift\\\x95\xb7", 278, "\x95", 350,
    "()-`r\x93\x94", 333, "{}", 334, "\x22", 355, "*", 389, "^", 469,
    "Jcksvxyz", 500, "#$0123456789_abdeghnopquL\x96", 556,
    "+<=>~", 584, "FTZ", 611, "&ABEKPSVXY", 667,
    "CDHNRU", 722, "GOQ", 778, "Mm", 833, "%", 889, "w", 722,
    "W", 944, "\x97\x85", 1000, "@", 1015, "[]", 278, "'", 191,
  ]);
  load(OB_WBOLD, [
    "'", 238, " ,./Iijl\\\x92\x91\xb7", 278, "|", 280,
    "!()-:;[]`ft", 333, "\x95", 350, "*r{}", 389, "\x22", 474,
    "z\x93\x94", 500, "#$0123456789_aceJksxy\x96", 556,
    "+<=>^~", 584, "?FLTZbdghnopqu", 611, "EPSVXY", 667,
    "&ABCDHKNRU", 722, "GOQw", 778, "M", 833, "%m", 889,
    "W", 944, "@", 975, "\x97\x85", 1000,
  ]);
})();

function obTextWidth(s, bold, size) {
  var tbl = bold ? OB_WBOLD : OB_WREG, w = 0, i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    w += tbl[c] === undefined ? (bold ? 611 : 556) : tbl[c];
  }
  return w * size / 1000;
}

function obEsc(s) {
  return s.replace(/[\\()]/g, function (m) { return "\\" + m; });
}

/* ------------------------------------------------- markdown to blocks */

function obParse(md) {
  var src = obWin(md)
    .replace(/\{\{ENTITY\}\}/g, obWin(OB_CONTRACT.entity))
    .replace(/\{\{STATE\}\}/g, obWin(OB_CONTRACT.state))
    .replace(/<!--[\s\S]*?-->/g, "");
  var out = [], para = [];
  function flush() {
    if (para.length) out.push({ type: "p", text: para.join(" ") });
    para = [];
  }
  src.split("\n").forEach(function (raw) {
    var line = raw.replace(/\s+$/, ""), m;
    if (!line.trim()) { flush(); return; }
    if ((m = /^#\s+(.*)$/.exec(line)))  { flush(); out.push({ type: "h1", text: m[1] }); return; }
    if ((m = /^##\s+(.*)$/.exec(line))) { flush(); out.push({ type: "h2", text: m[1] }); return; }
    if (/^---+$/.test(line))            { flush(); out.push({ type: "rule" }); return; }
    if ((m = /^-\s+(.*)$/.exec(line)))  { flush(); out.push({ type: "li", marker: "\x95", text: m[1] }); return; }
    if ((m = /^(\d+)\.\s+(.*)$/.exec(line))) {
      flush(); out.push({ type: "li", marker: m[1] + ".", text: m[2] }); return;
    }
    /* A wrapped continuation of the item above, not a new paragraph. */
    if (!para.length && out.length && out[out.length - 1].type === "li" && /^\s+\S/.test(raw)) {
      out[out.length - 1].text += " " + line.trim();
      return;
    }
    para.push(line.trim());
  });
  flush();
  return out;
}

/* **bold** inside a line, as a list of words tagged with their weight.
   The markers are stripped first and the weight tracked per character,
   because a bold run ends mid-word more often than not -- "recorded**,"
   -- and splitting on the markers first would push that comma away from
   the word it belongs to. A word that straddles the end of a run comes
   back as two pieces, the second marked `join`: set tight against the
   first, with no space and no line break between them. */
function obWords(text) {
  var plain = "", weight = [], i = 0, on = false;
  while (i < text.length) {
    if (text.charAt(i) === "*" && text.charAt(i + 1) === "*") { on = !on; i += 2; continue; }
    plain += text.charAt(i);
    weight.push(on);
    i++;
  }
  var toks = [], j = 0;
  while (j < plain.length) {
    if (/\s/.test(plain.charAt(j))) { j++; continue; }
    var end = j;
    while (end < plain.length && !/\s/.test(plain.charAt(end))) end++;
    var a = j;
    while (a < end) {
      var b = a;
      while (b < end && weight[b] === weight[a]) b++;
      toks.push({ t: plain.slice(a, b), b: weight[a], join: a > j });
      a = b;
    }
    j = end;
  }
  return toks;
}

function obWrap(toks, size, maxW) {
  var lines = [], cur = [], w = 0;
  toks.forEach(function (tok) {
    var apart = cur.length > 0 && !tok.join;
    var sp = apart ? obTextWidth(" ", tok.b, size) : 0;
    var tw = obTextWidth(tok.t, tok.b, size);
    if (apart && w + sp + tw > maxW) { lines.push(cur); cur = []; w = 0; sp = 0; }
    cur.push({ t: (cur.length && !tok.join ? " " : "") + tok.t, b: tok.b });
    w += sp + tw;
  });
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[{ t: "", b: false }]];
}

/* ------------------------------------------------------------ layout */

var OB_PAGE_W = 612, OB_PAGE_H = 792;
var OB_L = 56, OB_R = 56, OB_TOP = 60, OB_BOT = 72;
var OB_COL = OB_PAGE_W - OB_L - OB_R;

var OB_SIZE = { h1: 17, h2: 11.5, body: 9.8, small: 8.2, foot: 7.4 };
var OB_LEAD = { h1: 21, h2: 15, body: 13.4, small: 11.4 };

/* Items are laid out in one stream and cut into pages afterwards, so a
   heading never lands alone at the foot of a page: it carries the two
   lines after it, and the three move together. */
function obFlow(blocks) {
  var items = [];
  blocks.forEach(function (b) {
    if (b.type === "rule") { items.push({ kind: "gap", h: 10 }); return; }
    if (b.type === "h1") {
      items.push({ kind: "gap", h: items.length ? 16 : 0 });
      obWrap(obWords(b.text), OB_SIZE.h1, OB_COL).forEach(function (ln, i, all) {
        items.push({ kind: "text", runs: ln, size: OB_SIZE.h1, bold: true,
          lead: OB_LEAD.h1, x: OB_L, hold: i === all.length - 1 ? 2 : 0 });
      });
      items.push({ kind: "gap", h: 6 });
      return;
    }
    if (b.type === "h2") {
      items.push({ kind: "gap", h: 13 });
      obWrap(obWords(b.text), OB_SIZE.h2, OB_COL).forEach(function (ln, i, all) {
        items.push({ kind: "text", runs: ln, size: OB_SIZE.h2, bold: true,
          lead: OB_LEAD.h2, x: OB_L, hold: i === all.length - 1 ? 2 : 0 });
      });
      items.push({ kind: "gap", h: 4 });
      return;
    }
    if (b.type === "li") {
      var ind = 20;
      items.push({ kind: "gap", h: 4 });
      obWrap(obWords(b.text), OB_SIZE.body, OB_COL - ind).forEach(function (ln, i) {
        items.push({ kind: "text", runs: ln, size: OB_SIZE.body, lead: OB_LEAD.body,
          x: OB_L + ind, marker: i === 0 ? b.marker : null, markerX: OB_L + 4 });
      });
      return;
    }
    items.push({ kind: "gap", h: 7 });
    obWrap(obWords(b.text), OB_SIZE.body, OB_COL).forEach(function (ln) {
      items.push({ kind: "text", runs: ln, size: OB_SIZE.body, lead: OB_LEAD.body, x: OB_L });
    });
  });
  return items;
}

function obPaginate(items) {
  var pages = [], page = [], y = OB_PAGE_H - OB_TOP, i;

  function height(it) {
    if (it.kind === "gap") return it.h;
    if (it.kind === "text") return it.lead;
    if (it.kind === "img") return it.h + (it.gap || 0);
    if (it.kind === "rule") return (it.gap || 0) + 1;
    return 0;
  }
  function need(from) {
    /* A heading asks to keep the next `hold` text lines with it. */
    var h = height(items[from]), left = items[from].hold || 0, j = from + 1;
    while (left > 0 && j < items.length) {
      h += height(items[j]);
      if (items[j].kind === "text") left--;
      j++;
    }
    return h;
  }
  function brk() { pages.push(page); page = []; y = OB_PAGE_H - OB_TOP; }

  for (i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.kind === "break") { if (page.length) brk(); continue; }
    if (it.kind === "gap" && !page.length) continue;         /* no gap at a page top */
    if (y - need(i) < OB_BOT) brk();
    if (it.kind === "gap") { y -= it.h; continue; }
    if (it.kind === "rule") {
      y -= (it.gap || 0);
      page.push({ kind: "rule", y: y, x1: it.x1 || OB_L, x2: it.x2 || (OB_PAGE_W - OB_R) });
      y -= 1;
      continue;
    }
    if (it.kind === "img") {
      y -= (it.gap || 0) + it.h;
      page.push({ kind: "img", x: it.x, y: y, w: it.w, h: it.h });
      continue;
    }
    y -= it.lead;
    page.push({ kind: "text", y: y, x: it.x, size: it.size, bold: it.bold,
      runs: it.runs, grey: it.grey, marker: it.marker, markerX: it.markerX });
  }
  if (page.length) pages.push(page);
  return pages;
}

/* ------------------------------------------------- the execution block */

var OB_INITIAL_ROWS = [["access", "No access before signature (s.2)"], ["nda", "Strict NDA / protected reporting (s.7)"], ["nonsolicit", "12-month non-solicitation (s.11)"], ["debt", "Writing agent primary obligor (s.16)"], ["guaranty", "Personal & hierarchy-debt guaranty (s.17)"], ["jury", "Jury-trial waiver (s.31)"], ["book", "Protected book / no book stripping (s.38)"], ["eo", "E&O insurance (s.39)"], ["ip", "IP & successor rights (s.42)"], ["sp_nonsolicit", "Special \u2014 12-month non-solicitation"], ["sp_debt", "Special \u2014 debt + hierarchy guaranty"], ["sp_nda", "Special \u2014 NDA / protected reporting"], ["sp_book", "Special \u2014 protected book"], ["sp_eo", "Special \u2014 E&O insurance"], ["sp_ip", "Special \u2014 IP / change of control"]];

function obExecution(rec, which) {
  var lt = which === "lt";
  var name = lt ? rec.signedName : rec.thriveSignedName;
  var date = lt ? rec.signedDate : rec.thriveSignedDate;
  var items = [];

  items.push({ kind: "break" });
  items.push({ kind: "gap", h: 2 });
  obWrap(obWords("Signed and agreed"), OB_SIZE.h2, OB_COL).forEach(function (ln) {
    items.push({ kind: "text", runs: ln, size: OB_SIZE.h2, bold: true, lead: OB_LEAD.h2, x: OB_L });
  });
  items.push({ kind: "rule", gap: 6 });
  items.push({ kind: "gap", h: 12 });

  function row(label, value) {
    items.push({ kind: "text", runs: [{ t: obWin(label).toUpperCase(), b: false }],
      size: OB_SIZE.foot, lead: 10.5, x: OB_L, grey: true });
    items.push({ kind: "text", runs: [{ t: obWin(value || "\x97"), b: false }],
      size: OB_SIZE.body, lead: OB_LEAD.body, x: OB_L });
    items.push({ kind: "gap", h: 5 });
  }

  row("Full legal name", rec.legalName);
  row("Business", rec.business);
  row("Email", rec.email);
  row("Phone", rec.phone);
  if (rec.npn) row("NPN", rec.npn);
  if (lt && rec.startTime) row("Calls start", rec.startTime);
  if (rec.referrer) row("Brought in by", rec.referrer);
  row("Agreement version", rec.version);
  /* The Thrive Companies agreement is initialled line by line. */
  if (!lt && rec.thriveInitials) {
    OB_INITIAL_ROWS.forEach(function (r) {
      if (rec.thriveInitials[r[0]]) row("Initialled: " + r[1], rec.thriveInitials[r[0]]);
    });
  }
  row("Signed as typed", name);
  row("Dated", date);

  items.push({ kind: "gap", h: 10 });
  items.push({ kind: "text", runs: [{ t: "SIGNATURE", b: false }],
    size: OB_SIZE.foot, lead: 12, x: OB_L, grey: true });
  return items;
}

function obSigFooter(rec) {
  var items = [];
  items.push({ kind: "rule", gap: 10, x2: OB_L + 250 });
  items.push({ kind: "gap", h: 4 });
  items.push({ kind: "text",
    runs: [{ t: obWin("Received " + obStamp(rec.signedAt) + "  \x95  record " + (rec.id || "\x97")), b: false }],
    size: OB_SIZE.foot, lead: 11, x: OB_L, grey: true });
  return items;
}

function obStamp(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d)) return "\x97";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/* --------------------------------------------- the signature, as JPEG */

/* Canvas hands back a baseline JPEG, which PDF embeds as-is under
   /DCTDecode. The pad is drawn with alpha, so it is flattened onto
   white first or the ink would come out on black. */
function obSignatureJpeg(dataUrl) {
  return new Promise(function (resolve) {
    if (!dataUrl || !/^data:image\//.test(dataUrl)) { resolve(null); return; }
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { resolve(null); return; }
      var cap = 1100, k = Math.min(1, cap / w);
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      var g = c.getContext("2d");
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      var url;
      try { url = c.toDataURL("image/jpeg", 0.92); } catch (e) { resolve(null); return; }
      var b64 = url.slice(url.indexOf(",") + 1), bin = atob(b64);
      var bytes = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve({ bytes: bytes, w: c.width, h: c.height });
    };
    img.onerror = function () { resolve(null); };
    img.src = dataUrl;
  });
}

/* ------------------------------------------------------- the PDF file */

function obLatin1(s) {
  var a = new Uint8Array(s.length), i;
  for (i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

function ObBuf() { this.parts = []; this.len = 0; }
ObBuf.prototype.push = function (x) {
  var b = typeof x === "string" ? obLatin1(x) : x;
  this.parts.push(b); this.len += b.length; return this;
};
ObBuf.prototype.bytes = function () {
  var all = new Uint8Array(this.len), at = 0, i;
  for (i = 0; i < this.parts.length; i++) { all.set(this.parts[i], at); at += this.parts[i].length; }
  return all;
};

function obStream(page, imgName) {
  var s = "";
  page.forEach(function (op) {
    if (op.kind === "rule") {
      s += "0.84 0.86 0.89 RG 0.7 w " + op.x1.toFixed(2) + " " + op.y.toFixed(2) +
           " m " + op.x2.toFixed(2) + " " + op.y.toFixed(2) + " l S\n";
      return;
    }
    if (op.kind === "img") {
      s += "q " + op.w.toFixed(2) + " 0 0 " + op.h.toFixed(2) + " " +
           op.x.toFixed(2) + " " + op.y.toFixed(2) + " cm /" + imgName + " Do Q\n";
      return;
    }
    var x = op.x, grey = op.grey;
    if (op.marker) {
      s += "BT /F2 " + op.size.toFixed(2) + " Tf " + op.markerX.toFixed(2) + " " +
           op.y.toFixed(2) + " Td (" + obEsc(op.marker) + ") Tj ET\n";
    }
    if (grey) s += "0.42 0.46 0.52 rg\n";
    op.runs.forEach(function (run) {
      var bold = op.bold || run.b;
      if (run.t) {
        s += "BT /" + (bold ? "F2" : "F1") + " " + op.size.toFixed(2) + " Tf " +
             x.toFixed(2) + " " + op.y.toFixed(2) + " Td (" + obEsc(run.t) + ") Tj ET\n";
      }
      x += obTextWidth(run.t, bold, op.size);
    });
    if (grey) s += "0 g\n";
  });
  return s;
}

function obFooter(pageNo, total, caption) {
  var size = OB_SIZE.foot, y = 40;
  var right = "Page " + pageNo + " of " + total;
  var rw = obTextWidth(right, false, size);
  return "0.42 0.46 0.52 rg\n" +
    "BT /F1 " + size + " Tf " + OB_L + " " + y + " Td (" + obEsc(caption) + ") Tj ET\n" +
    "BT /F1 " + size + " Tf " + (OB_PAGE_W - OB_R - rw).toFixed(2) + " " + y +
    " Td (" + obEsc(right) + ") Tj ET\n0 g\n";
}

function obAssemble(pages, img, title, caption) {
  var objs = [null, null], i;
  function add(o) { objs.push(o); return objs.length; }

  var fReg  = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  var fBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  var d = new Date();
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  var stamp = "D:" + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
    p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z";
  var info = add("<< /Title (" + obEsc(obWin(title)) + ") /Producer (Lead Tech Fulfillment) " +
    "/CreationDate (" + stamp + ") >>");

  var imgNum = 0;
  if (img) {
    imgNum = add({
      head: "<< /Type /XObject /Subtype /Image /Width " + img.w + " /Height " + img.h +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
        img.bytes.length + " >>\n",
      bytes: img.bytes,
    });
  }
  var res = "<< /Font << /F1 " + fReg + " 0 R /F2 " + fBold + " 0 R >>" +
    (imgNum ? " /XObject << /Im0 " + imgNum + " 0 R >>" : "") + " >>";

  var kids = [];
  pages.forEach(function (page, n) {
    var body = obStream(page, "Im0") + obFooter(n + 1, pages.length, caption);
    var cNum = add({ head: "<< /Length " + obLatin1(body).length + " >>\n", bytes: obLatin1(body) });
    var pNum = add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + OB_PAGE_W + " " + OB_PAGE_H +
      "] /Resources " + res + " /Contents " + cNum + " 0 R >>");
    kids.push(pNum + " 0 R");
  });

  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = "<< /Type /Pages /Count " + kids.length + " /Kids [" + kids.join(" ") + "] >>";

  var out = new ObBuf();
  out.push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  var offsets = [];
  for (i = 0; i < objs.length; i++) {
    offsets.push(out.len);
    out.push((i + 1) + " 0 obj\n");
    if (typeof objs[i] === "string") out.push(objs[i]);
    else { out.push(objs[i].head); out.push("stream\n"); out.push(objs[i].bytes); out.push("\nendstream"); }
    out.push("\nendobj\n");
  }
  var xref = out.len;
  out.push("xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n");
  for (i = 0; i < objs.length; i++) {
    out.push(("0000000000" + offsets[i]).slice(-10) + " 00000 n \n");
  }
  out.push("trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R /Info " + info +
    " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
  return out.bytes();
}

/* ----------------------------------------------------------- the call */

/* Chrome throws away the whole download name if a single character in
   it is not ASCII, so "Jos\u00e9" would cost the file its name rather
   than its accent. The accents are folded off here; the agreement
   itself still carries the name as it was given. */
function obSafeName(s) {
  var t = String(s || "");
  try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) { /* older engine, take it as it is */ }
  return t.replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim() || "unnamed";
}

/* `which` is "lt" for the Lead Tech agreement or "tc" for the Thrive
   Companies one. `rec` is the stored document, signatures and all. */
function obContractPdf(rec, which) {
  var lt = which === "lt";
  var md = lt ? OB_CONTRACT.lt : OB_CONTRACT.tc;
  var title = lt ? "Lead Tech Marketing Services Agreement" : "Thrive Companies Agent & Manager Agreement";
  var sig = lt ? rec.signature : rec.thriveSignature;
  var name = lt ? rec.signedName : rec.thriveSignedName;
  var date = lt ? rec.signedDate : rec.thriveSignedDate;

  return obSignatureJpeg(sig).then(function (img) {
    var items = obFlow(obParse(md));

    /* The record says which wording was signed. If the board is not
       carrying that wording, the PDF says so rather than quietly
       presenting today's text as the one somebody agreed to. */
    if (rec.version && OB_CONTRACT.version && rec.version !== OB_CONTRACT.version) {
      var warn = "This copy reproduces the Version " + OB_CONTRACT.version +
        " wording held by the board. The record on file was signed under Version " +
        rec.version + ", whose wording is not carried here.";
      items = [{ kind: "gap", h: 4 }].concat(
        obWrap(obWords(warn), OB_SIZE.small, OB_COL).map(function (ln) {
          return { kind: "text", runs: ln, size: OB_SIZE.small, lead: OB_LEAD.small, x: OB_L, grey: true };
        }),
        [{ kind: "rule", gap: 8 }, { kind: "gap", h: 6 }],
        items
      );
    }

    items = items.concat(obExecution(rec, which));
    if (img) {
      var h = 52, w = img.w * h / img.h;
      if (w > 260) { w = 260; h = img.h * w / img.w; }
      items.push({ kind: "img", x: OB_L, w: w, h: h, gap: 2 });
    } else {
      items.push({ kind: "text", runs: [{ t: "not on file", b: false }],
        size: OB_SIZE.body, lead: OB_LEAD.body, x: OB_L, grey: true });
    }
    items.push({ kind: "rule", gap: 6, x2: OB_L + 260 });
    items.push({ kind: "gap", h: 4 });
    items.push({ kind: "text",
      runs: [{ t: obWin((name || "\x97") + "  \x95  " + (date || "\x97")), b: false }],
      size: OB_SIZE.small, lead: OB_LEAD.small, x: OB_L });
    items = items.concat(obSigFooter(rec));

    var caption = title + "  \x95  Version " + (rec.version || OB_CONTRACT.version) +
      "  \x95  " + obWin(rec.legalName || "");
    var bytes = obAssemble(obPaginate(items), img, title, caption);
    return {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: obSafeName(title + " - " + rec.legalName + " - " + (date || "")) + ".pdf",
    };
  });
}

function obSaveWhy(code) {
  if (code === "declined") return "the download was turned down.";
  if (code === "extension_not_enabled") return "saving files is switched off for this page.";
  return "the browser would not save it (" + (code || "unavailable") + ").";
}

/* The board's own helper, which asks the artifact host to save the file
   when the board is running as an artifact and falls back to an anchor
   when it is not. It answers {ok} rather than throwing. */
function obDownload(out) {
  return Promise.resolve(__SAVE__(out.filename, out.blob)).then(function (r) {
    if (r && r.ok === false) throw new Error("The PDF was built, but " + obSaveWhy(r.code));
    return r;
  });
}
