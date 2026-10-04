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
python3 call-sync/call_sync.py --since "$SINCE" --out /tmp/calls --dump-raw
```
Read `/tmp/calls/_summary.json`. If a source reports an error, keep going with the other one
and record the error in step 5. On the first successful run, check `_raw_retreaver.json` and
`_raw_callgrid.json` against the normalized files. If agent, caller, length or outcome came out
wrong, fix the patterns in `FIELDS` in `call_sync.py`, re-run, and commit the fix.

## 3. Skip calls already in the dashboard
For each call in `_summary.json`, `get` collection `calls` with that id. If it exists and already
has a `review`, skip it. If it exists without a review but now has a transcript, update it.

## 4. Review each call with a transcript, longest first
- Rules: `get` collection `config`, doc `settings`. Use its `rules`, `instructions`, `keyDetails`
  and `mustMin`. If the doc doesn't exist, use `call-sync/default_rules.json`.
- Review the transcript the way a careful, fair compliance auditor for an inbound life insurance
  call center would. Check every rule. Transcripts may be machine-generated ("Speaker 0/1"):
  work out which speaker is the agent from context.
- Add a `review` field to the call document in exactly this shape:
  ```
  {"trustScore": 0-100,
   "summary": "2-3 plain sentences",
   "keyDetails": [{"label": "<each keyDetails label, in order>", "value": "" if not mentioned}],
   "checklist": [{"rule": "R1 short restatement", "status": "met|missed|unclear|na", "evidence": "..."}],
   "flags": [{"severity": "critical|warning|info", "title": "...", "quote": "verbatim from ONE transcript line, under 25 words", "explanation": "..."}],
   "reviewedAt": "<now, ISO>"}
  ```
  Order flags critical first.
- Scoring: start at 100. Each missed critical rule or misrepresentation costs 20-35 points; each
  missed warning rule or pressure moment costs 5-12; info costs 0-3; "unclear" costs nothing. A
  clean call lands 85-100.
- Set `status` to `"ai"`. Leave calls without a transcript at `"new"` (they still appear on the
  dashboard, and 20+ minute ones are still marked for review).

## 5. Write and record the run
- Write calls with `batch` (up to 50 per batch). New docs: `set` with the file contents plus
  `review`, `status`, and `createdAt`. Existing docs: `update` with `if_version`.
- `set` collection `config`, doc `sync`:
  `{"lastSyncedAt": <ranAt from _summary.json>, "lastRunAt": <now>, "newCalls": n, "reviewed": n,
    "longCalls": <count at or over mustMin minutes>, "errors": [<one plain-English line per source error>]}`
  Pass `if_version` if the doc already exists.

Never print, log or commit API keys. Never change review statuses an admin set
(`approved`, `escalated`) or their notes.
