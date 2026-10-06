# Hourly call sync and compliance review

The scheduled Claude routine follows these steps every hour. The dashboard is
https://claude.ai/artifact/8qpNA8ZRr2GjFurdFghNuq. All reads and writes go through the
ArtifactData tool with that URL.

## 1. Find the sync window
- `get` collection `config`, doc `sync`. Use `lastSyncedAt` minus 10 minutes as `SINCE`
  (the overlap catches calls that finished just after the last run; doc ids prevent duplicates).
- If the doc doesn't exist, use 2 hours ago.

## 2. Pull calls
```
python3 call-sync/call_sync.py --since "$SINCE" --out .sync-out --dump-raw
```
Read `.sync-out/_summary.json`. If a source reports an error, keep going with the other one
and record the error in step 5. On the first successful run, check `_raw_retreaver.json` and
`_raw_callgrid.json` against the normalized files. If agent, caller, length or outcome came out
wrong, fix the patterns in `FIELDS` in `call_sync.py`, re-run, and commit the fix.

Write into `.sync-out` inside the repo checkout (it is gitignored): recordings must be inside the
working directory to be uploaded.

## 3. Skip calls already in the dashboard
For each call in `_summary.json`, `get` collection `calls` with that id. If it exists and already
has a `review`, skip it. If it exists without a review but now has a transcript, update it.

## 4. Review each call with a transcript, longest first
- Rules: `get` collection `config`, doc `settings`. Use its `rules`, `instructions`, `keyDetails`
  and `mustMin`. If the doc doesn't exist, use `call-sync/default_rules.json`.
- Context: we are an independent life insurance policy support desk, not a carrier. Callers often
  think they reached their insurance company. Agents review the caller's policy and may place them
  with a new carrier.
- Review the transcript the way a careful, fair compliance auditor would. Check every rule, and
  follow the settings doc's `instructions`. Transcripts may be machine-generated ("Speaker 0/1"):
  work out which speaker is the agent from context.
- Add a `review` field to the call document in exactly this shape:
  ```
  {"trustScore": 0-100,
   "carrier": {"askedFor": "carrier the caller asked for or was trying to reach, else empty",
               "current": "carrier of the caller's existing policy, else empty",
               "placedWith": "carrier the agent placed or is moving them with on this call, else empty",
               "identityHandling": "correct | incorrect | not_asked",
               "identityQuote": "agent's exact words when it came up, under 25 words, else empty"},
   "summary": "2-3 plain sentences",
   "keyDetails": [{"label": "<each keyDetails label, in order>", "value": "" if not mentioned}],
   "checklist": [{"rule": "R1 short restatement", "status": "met|missed|unclear|na", "evidence": "..."}],
   "flags": [{"severity": "critical|warning|info", "title": "...", "quote": "verbatim from ONE transcript line, under 25 words, without the [mm:ss] timestamp", "explanation": "...",
              "startSec": <seconds into the call where the problem starts, or null>, "endSec": <seconds where it ends, or null>}],
   "reviewedAt": "<now, ISO>"}
  ```
  Order flags critical first.
- Flag times: transcripts from the sync start each line with `[mm:ss]`. Set `startSec`/`endSec` to
  cover the whole stretch where the problem happens, which can span several lines (for example
  1080 to 1260 for 18:00 to 21:00). Admins use these to jump the recording to that moment. Use null
  when the transcript has no timestamps.
- Carrier identity: "correct" when the caller asked whether we are a carrier (or clearly assumed it)
  and the agent did not confirm it ("That's one of the carriers we can help assist with").
  "incorrect" when the agent said yes, said or implied we are the carrier or work for it, or let the
  caller keep believing it. "not_asked" when it never came up. "incorrect" is always also a
  critical flag.
- Scoring: start at 100. Each missed critical rule or misrepresentation costs 20-35 points; each
  missed warning rule or pressure moment costs 5-12; info costs 0-3; "unclear" costs nothing. A
  clean call lands 85-100.
- Set `status` to `"ai"`. Leave calls without a transcript at `"new"` (they still appear on the
  dashboard, and 20+ minute ones are still marked for review).

## 5. Attach recordings
For each call in `_summary.json` with a `recordingFile` whose dashboard doc has no `recordingAsset`
yet, upload the file to the dashboard's asset store with the Artifact tool: `action: "publish"`,
`url` = the dashboard URL, `asset: true`, and `file_paths` with up to 25 `.mp4` files per call.
Each result gives the file's asset `id`. Add `"recordingAsset": <id>, "recordingType": "video/mp4"`
to that call's document in step 6. If an upload fails, skip it; the dashboard falls back to a link
to the platform's recording.

## 6. Write and record the run
- Write calls with `batch` (up to 50 per batch). New docs: `set` with the file contents plus
  `review`, `status`, and `createdAt`. Existing docs: `update` with `if_version`.
- `set` collection `config`, doc `sync`:
  `{"lastSyncedAt": <ranAt from _summary.json>, "lastRunAt": <now>, "newCalls": n, "reviewed": n,
    "longCalls": <count at or over mustMin minutes>, "errors": [<one plain-English line per source error>]}`
  Pass `if_version` if the doc already exists.

Never print, log or commit API keys. Never change review statuses an admin set
(`approved`, `escalated`) or their notes.
