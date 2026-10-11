# Running the Supabase tests

These run the real relay against a real Postgres, so a change to the
store or the schema is checked before it reaches the live database
rather than after.

Supabase itself is not involved. `postgrest-shim.mjs` stands in for
PostgREST — just the handful of query shapes `supabase-store.js`
actually produces, translated to SQL. It exists so the tests need no
project, no network and no credentials.

    # once
    sudo apt-get install -y postgresql
    sudo service postgresql start
    sudo -u postgres createdb thrive
    sudo -u postgres psql -d thrive -f ../../supabase/schema.sql
    npm install pg

    # every time
    node postgrest-shim.mjs &
    node store.test.mjs       # the store: get, put, list, ttl, projections
    node worker.test.mjs      # the whole relay: sign in, save, sign a contract
    node migrate.test.mjs     # the copy from Cloudflare KV lands and re-runs clean

Each exits non-zero on a failure.
