import cron from "node-cron";
import { syncAll } from "./sync";
import { plaidConfigured } from "./plaid";

const g = globalThis as unknown as { __financeCron?: boolean };

export function startScheduler() {
  if (g.__financeCron) return;
  g.__financeCron = true;
  const expr = process.env.SYNC_CRON || "0 7,19 * * *";
  if (!cron.validate(expr)) {
    console.error(`[scheduler] invalid SYNC_CRON "${expr}", scheduler disabled`);
    return;
  }
  cron.schedule(
    expr,
    async () => {
      if (!plaidConfigured()) return;
      console.log("[scheduler] running scheduled sync");
      await syncAll("schedule");
    },
    { timezone: process.env.TZ || "America/New_York" },
  );
  console.log(`[scheduler] full sync scheduled: "${expr}" (${process.env.TZ || "America/New_York"})`);
}
