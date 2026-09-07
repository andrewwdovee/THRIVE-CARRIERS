/* ======================================================================
   Relay storage for the LOA Producer Desk.

   The desk was built to save by republishing its own page: the whole
   state lives in a <script id="tc-state"> block, and every commit writes
   a new version of the document. That works, but the record is then
   locked inside a claude.ai artifact where nothing else can read it —
   which is why the owner console could never see LOA numbers without
   someone pasting a file across.

   This gives the desk a second home. When the page is built with a relay
   URL, the state is read from and written to that relay instead, and
   every save also publishes a scrubbed copy for the console. Producers
   see no difference: same login, same tabs, same numbers.

   Two keys, deliberately:

     loa.state      the desk's own record, including agent password
                    hashes, which it needs to sign people in
     snapshots.loa  a copy with those hashes stripped and the carrier
                    names folded in, which is all the console reads

   Credentials therefore never reach the key the console reads.

   Injected before the desk's own code, which then calls into it.
   ====================================================================== */
(function () {
  "use strict";

  var RELAY = String(window.THRIVE_RELAY || "").replace(/\/+$/, "");
  var TOKEN = String(window.THRIVE_DESK_TOKEN || "");
  var STATE_KEY = "loa.state";
  var SNAPSHOT_KEY = "snapshots.loa";
  var POLL_MS = 60000;

  if (!RELAY || !TOKEN) {
    window.TC_RELAY = null;   /* the desk falls back to publishing itself */
    return;
  }

  function req(key, opts) {
    opts = opts || {};
    return fetch(RELAY + "/kv/" + encodeURIComponent(key), {
      method: opts.method || "GET",
      headers: Object.assign(
        { Authorization: "Bearer " + TOKEN },
        opts.body ? { "Content-Type": "application/json" } : {}
      ),
      body: opts.body
    });
  }

  function load() {
    return req(STATE_KEY).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Could not read the desk record (" + res.status + ").");
      return res.json();
    }).then(function (body) {
      if (!body) return null;
      try { return typeof body.value === "string" ? JSON.parse(body.value) : body.value; }
      catch (e) { return null; }
    });
  }

  function put(key, obj) {
    return req(key, { method: "PUT", body: JSON.stringify({ value: JSON.stringify(obj) }) })
      .then(function (res) {
        if (!res.ok) throw new Error("Save failed (" + res.status + ").");
        return true;
      });
  }

  /* What the console reads. Agent password hashes are dropped here and
     the carrier names are folded in, so the console needs nothing else
     and never sees a credential. */
  function snapshotOf(state, carriers) {
    var agents = (state.agents || []).map(function (a) {
      var copy = {};
      for (var k in a) {
        if (Object.prototype.hasOwnProperty.call(a, k) && k !== "pwSalt" && k !== "pwHash") copy[k] = a[k];
      }
      return copy;
    });
    var map = {};
    (carriers || []).forEach(function (c) { map[c.id] = c.name; });
    return {
      syncedAt: new Date().toISOString(),
      syncedBy: "the desk itself",
      sourceUpdatedAt: state.updatedAt || "",
      sourceVersion: state.version,
      org: state.org || {},
      agents: agents,
      deals: state.deals || [],
      calls: state.calls || [],
      goals: state.goals || {},
      carriers: map
    };
  }

  window.TC_RELAY = {
    url: RELAY,
    load: load,
    /* Both keys on every save. If the snapshot write fails the desk's own
       record is still safe — the console just shows older numbers until
       the next save, which is the right way round to fail. */
    save: function (state, carriers) {
      return put(STATE_KEY, state).then(function () {
        return put(SNAPSHOT_KEY, snapshotOf(state, carriers)).catch(function () { return true; });
      });
    },
    /* Several producers share this desk, so a page left open must notice
       other people's saves rather than sit on a stale copy and overwrite
       them. */
    watch: function (cb) {
      setInterval(function () {
        load().then(function (fresh) { if (fresh) cb(fresh); }).catch(function () {});
      }, POLL_MS);
    }
  };
})();
