#!/usr/bin/env python3
"""Pull new calls from Retreaver and CallGrid and write them as dashboard call documents.

Run by the hourly Claude routine (see call-sync/ROUTINE.md). Standard library only.

Environment:
  RETREAVER_API_KEY       Retreaver Core API key (account portal > API access)
  RETREAVER_COMPANY_ID    optional, when the key can see more than one company
  CALLGRID_API_KEY        CallGrid API key (account settings > API keys)
  CALLGRID_CALLS_URL      optional, overrides the CallGrid call-log endpoint
  DEEPGRAM_API_KEY        optional, transcribes recordings that arrive without a transcript

Usage:
  python3 call_sync.py --since 2026-10-04T13:00:00Z --out /tmp/calls [--dump-raw]

Writes <out>/<doc_id>.json per call (dashboard shape), <out>/<doc_id>.mp4 per recording
(mono AAC, the audio format the dashboard can store) and <out>/_summary.json.
Transcripts from Deepgram carry [mm:ss] line timestamps so flags can point to a time in the call.
"""
import argparse, datetime as dt, json, os, re, shutil, subprocess, sys, urllib.error, urllib.parse, urllib.request

RETREAVER_URL = "https://api.retreaver.com/api/v4/calls.json"
CALLGRID_URL = os.environ.get("CALLGRID_CALLS_URL", "https://api.callgrid.com/v1/calls")
DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&utterances=true"
MAX_PAGES = 50


def http_json(url, headers=None, data=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"Accept": "application/json", **(headers or {})})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "null")


# ---------- field detection (both platforms name things differently) ----------
FIELDS = {
    "extId": [r"^(call_?)?uuid$", r"^(call_?)?sid$", r"^call_?id$", r"^id$"],
    "startedAt": [r"^(call_?)?start(ed)?_?(at|time)?$", r"^created_?at$", r"^(call_?)?(date|time|timestamp)$", r"start", r"created"],
    "durationSec": [r"^(call_?)?duration(_?sec(onds)?)?$", r"^connected_?duration", r"talk_?time", r"duration", r"length"],
    "agent": [r"agent", r"^target(_?name)?$", r"target", r"buyer(_?name)?", r"answered_?by", r"destination(_?name)?"],
    "caller": [r"^caller(_?(id|number|name))?$", r"^(from|ani)(_?number)?$", r"customer", r"caller"],
    "outcome": [r"disposition", r"outcome", r"^converted$", r"conversion", r"result", r"status"],
    "product": [r"campaign(_?name)?", r"product", r"offer"],
    "recordingUrl": [r"recording(_?url)?$", r"recording", r"audio"],
    "transcript": [r"transcript(ion)?(_?text)?$", r"transcri"],
}


def flatten(obj, prefix="", out=None):
    out = {} if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            flatten(v, f"{prefix}{k}" if not prefix else f"{prefix}.{k}", out)
    else:
        out[prefix] = obj
    return out


def snake(name):
    """startTime -> start_time, _id -> id, so both platforms' naming styles match the same patterns."""
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower().strip("_")


def pick(flat, key):
    names = sorted(flat, key=lambda n: n.count("."))  # top-level fields win over nested ones
    for pat in FIELDS[key]:
        rx = re.compile(pat, re.I)
        for n in names:  # match on the last path segment first, then the full path
            last, full = snake(n.rsplit(".", 1)[-1]), snake(n.replace(".", "_"))
            v = flat[n]
            if (rx.search(last) or rx.search(full)) and v not in (None, "", [], {}):
                if key in ("agent", "product") and (isinstance(v, (int, float)) or full.endswith("_id")):
                    continue
                return v
    return None


def to_seconds(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    if ":" in s:
        parts = [float(p) for p in s.split(":")]
        sec = 0
        for p in parts:
            sec = sec * 60 + p
        return int(sec)
    try:
        return int(float(s))
    except ValueError:
        return None


def to_iso(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) or re.fullmatch(r"\d{10,13}", str(v)):
        n = float(v)
        return dt.datetime.fromtimestamp(n / 1000 if n > 1e11 else n, dt.timezone.utc).isoformat().replace("+00:00", "Z")
    s = str(v).strip().replace(" UTC", "Z")
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def outcome_text(v):
    if isinstance(v, bool):
        return "Converted" if v else "Not converted"
    s = str(v or "").strip()
    if re.fullmatch(r"(?i)true|yes|1|converted", s):
        return "Converted"
    if re.fullmatch(r"(?i)false|no|0", s):
        return "Not converted"
    return s or "Unknown"


def normalize(raw, source, prefix):
    flat = flatten(raw)
    ext = pick(flat, "extId")
    started = to_iso(pick(flat, "startedAt"))
    dur = to_seconds(pick(flat, "durationSec"))
    if not ext or not started or dur is None:
        return None
    transcript = pick(flat, "transcript")
    if isinstance(transcript, list):
        transcript = "\n".join(str(x) for x in transcript)
    doc_id = prefix + re.sub(r"[^A-Za-z0-9_\-]", "", str(ext))[:80]
    return doc_id, {
        "agent": str(pick(flat, "agent") or "Unassigned"),
        "caller": str(pick(flat, "caller") or ""),
        "startedAt": started,
        "durationSec": dur,
        "outcome": outcome_text(pick(flat, "outcome")),
        "product": str(pick(flat, "product") or ""),
        "recordingUrl": str(pick(flat, "recordingUrl") or ""),
        "transcript": str(transcript or "")[:200000],
        "extId": str(ext),
        "source": source,
        "status": "new",
    }


def records(payload):
    """Find the list of call records in a response, whatever it is wrapped in."""
    if isinstance(payload, list):
        return [r.get("call", r) if isinstance(r, dict) else r for r in payload]
    if isinstance(payload, dict):
        for k in ("calls", "data", "results", "items", "records"):
            if isinstance(payload.get(k), list):
                return records(payload[k])
        for v in payload.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return records(v)
    return []


# ---------- sources ----------
def fetch_retreaver(since, dump):
    key = os.environ.get("RETREAVER_API_KEY")
    if not key:
        return [], "RETREAVER_API_KEY not set"
    out = []
    for page in range(1, MAX_PAGES + 1):
        q = {"api_key": key, "page": page, "created_at_start": since, "sort_by": "created_at", "order": "desc"}
        if os.environ.get("RETREAVER_COMPANY_ID"):
            q["company_id"] = os.environ["RETREAVER_COMPANY_ID"]
        payload = http_json(RETREAVER_URL + "?" + urllib.parse.urlencode(q))
        if dump and page == 1:
            json.dump(payload, open(os.path.join(dump, "_raw_retreaver.json"), "w"), indent=1, default=str)
        recs = records(payload)
        if not recs:
            break
        out += recs
        oldest = min((to_iso(pick(flatten(r), "startedAt")) or "9") for r in recs)
        if oldest < since:  # paged past the window
            break
    return out, None


def fetch_callgrid(since, dump):
    key = os.environ.get("CALLGRID_API_KEY")
    if not key:
        return [], "CALLGRID_API_KEY not set"
    out = []
    for page in range(1, MAX_PAGES + 1):
        q = {"page": page, "limit": 100, "start_date": since, "from": since}
        payload = http_json(CALLGRID_URL + "?" + urllib.parse.urlencode(q), headers={"Authorization": f"Bearer {key}"})
        if dump and page == 1:
            json.dump(payload, open(os.path.join(dump, "_raw_callgrid.json"), "w"), indent=1, default=str)
        recs = records(payload)
        if not recs:
            break
        out += recs
        if len(recs) < 100:
            break
    return out, None


def transcribe(url):
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key or not url.startswith("http"):
        return ""
    res = http_json(DEEPGRAM_URL, headers={"Authorization": f"Token {key}"}, data={"url": url}, timeout=300)
    utts = (res.get("results") or {}).get("utterances") or []
    return "\n".join(f"[{clock(u.get('start', 0))}] Speaker {u.get('speaker', '?')}: {u.get('transcript', '').strip()}"
                     for u in utts if u.get("transcript"))


def clock(sec):
    sec = int(sec or 0)
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fetch_recording(url, dest):
    """Download a recording and convert it to a small mono AAC .mp4, the audio format the dashboard can store."""
    if not url.startswith("http") or not shutil.which("ffmpeg"):
        return None
    raw = dest + ".src"
    with urllib.request.urlopen(urllib.request.Request(url), timeout=300) as r, open(raw, "wb") as f:
        shutil.copyfileobj(r, f)
    try:
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", raw, "-vn", "-ac", "1", "-ar", "16000",
                        "-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", dest], check=True, timeout=600)
    finally:
        os.remove(raw)
    if os.path.getsize(dest) > 20 * 1024 * 1024:  # dashboard limit; re-encode smaller
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", dest, "-c:a", "aac", "-b:a", "16k",
                        "-movflags", "+faststart", dest + ".small.mp4"], check=True, timeout=600)
        os.replace(dest + ".small.mp4", dest)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="ISO time; calls started at or after this are pulled")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-seconds", type=int, default=30)
    ap.add_argument("--skip-recordings", action="store_true", help="don't download recordings")
    ap.add_argument("--dump-raw", action="store_true", help="save each platform's first raw page for field checks")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    since = to_iso(a.since)
    summary = {"since": since, "ranAt": to_iso(dt.datetime.now(dt.timezone.utc).isoformat()), "sources": {}, "calls": []}

    for name, fn, prefix in (("Retreaver", fetch_retreaver, "rt-"), ("CallGrid", fetch_callgrid, "cg-")):
        src = {"pulled": 0, "kept": 0, "skippedShort": 0, "unreadable": 0, "transcribed": 0, "error": None}
        try:
            raws, skip = fn(since, a.out if a.dump_raw else None)
            if skip:
                src["error"] = skip
            src["pulled"] = len(raws)
            for raw in raws:
                n = normalize(raw, name, prefix)
                if not n:
                    src["unreadable"] += 1
                    continue
                doc_id, doc = n
                if doc["startedAt"] < since:
                    continue
                if doc["durationSec"] < a.min_seconds:
                    src["skippedShort"] += 1
                    continue
                if not doc["transcript"] and doc["recordingUrl"]:
                    try:
                        doc["transcript"] = transcribe(doc["recordingUrl"])
                        src["transcribed"] += bool(doc["transcript"])
                    except Exception as e:  # keep the call; it can be reviewed once a transcript exists
                        src.setdefault("transcribeErrors", []).append(f"{doc_id}: {e}")
                rec = None
                if doc["recordingUrl"] and not a.skip_recordings:
                    try:
                        rec = fetch_recording(doc["recordingUrl"], os.path.join(a.out, doc_id + ".mp4"))
                    except Exception as e:  # the call still syncs; the dashboard links to the platform instead
                        src.setdefault("recordingErrors", []).append(f"{doc_id}: {e}")
                json.dump(doc, open(os.path.join(a.out, doc_id + ".json"), "w"))
                summary["calls"].append({"id": doc_id, "durationSec": doc["durationSec"], "hasTranscript": bool(doc["transcript"]),
                                         "recordingFile": rec})
                src["kept"] += 1
        except urllib.error.HTTPError as e:
            src["error"] = f"HTTP {e.code} from {name}: {e.read()[:300].decode(errors='replace')}"
        except Exception as e:
            src["error"] = f"{name}: {e}"
        summary["sources"][name] = src

    summary["calls"].sort(key=lambda c: -c["durationSec"])  # longest first: most likely closes
    json.dump(summary, open(os.path.join(a.out, "_summary.json"), "w"), indent=1)
    print(json.dumps(summary["sources"], indent=1))
    print(f"{len(summary['calls'])} calls written to {a.out}")


if __name__ == "__main__":
    sys.exit(main())
