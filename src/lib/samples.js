import { DAY, HOUR, uid } from "./shared";

/* Fake orders that exercise the whole app: a week of delivered history so
   every report has numbers in it, plus a few live orders — one deliberately
   past its target — so the board shows both states. */

const NAMES = ["Marcus Webb", "Tanya Alvarez", "Derrick Poole", "Simone Carter", "Ray Whitfield", "Nina Okafor",
  "Chad Brenner", "Lucia Marín", "Owen Hartley", "Priya Raman", "Gus Delgado", "Halle Byrne"];
const STAFF = ["Alex Reyna", "Jordan Six", "Kim Petrov"];
const CARDS = ["visa", "mastercard", "amex", "discover"];

export function buildSamples(products) {
  if (!products.length) return [];
  const now = Date.now();
  return NAMES.map((nm, i) => {
    const p = products[i % products.length], bad = i % 7 === 3, sub = p.kind === "subscription", id = uid();
    const amt = [29700, 49700, 99700, 19700][i % 4], mail = nm.toLowerCase().replace(/[^a-z]/g, ".") + "@example.com";
    const sla = (p.slaHours || 24) * HOUR;
    const shipped = i < 8 && !bad;
    // Two of the delivered ones ran long, so "on target" isn't a flat 100%.
    const took = sla * (i % 4 === 2 ? 1.4 : 0.3 + (i % 3) * 0.2);
    const age = shipped ? (6 - i * 0.7) * DAY : sla * (i === 9 ? 1.6 : 0.2 + (i % 3) * 0.15);
    const at = now - age;
    return { source: "sample", externalId: `ch_s_${id}`, paymentId: `pi_s_${id}`, chargeId: `ch_s_${id}`,
      paymentStatus: bad ? "failed" : "succeeded", declineCode: bad ? "insufficient_funds" : "",
      declineReason: bad ? "Your card has insufficient funds." : "", amount: amt, currency: "USD",
      status: shipped ? "done" : bad ? "new" : i % 2 ? "active" : "new",
      completedAt: shipped ? at + took : null,
      assignee: shipped || (!bad && i % 2) ? STAFF[i % STAFF.length] : "Unassigned",
      checklist: shipped ? Object.fromEntries((p.steps || []).map((_, k) => [k, true])) : {},
      overdueNotified: shipped,
      // One delivered order came back as a refund, and the per-call product is
      // the one that actually gets refunded, so the page has something to show.
      refunded: shipped && i === 4,
      refundedAt: shipped && i === 4 ? at + took + 2 * HOUR : undefined,
      refundTypeId: shipped && i === 4 ? "rt_membership" : "",
      receivedAt: at, customerId: `cus_s_${id.slice(-8)}`, customer: nm,
      email: mail, phone: `+1727555${String(1e3 + i).slice(-4)}`, ownerName: nm, ownerEmail: mail,
      paymentMethodId: `pm_s_${id.slice(-8)}`, paymentMethodType: "card", cardBrand: CARDS[i % 4],
      cardLast4: String(4e3 + i * 7).slice(-4), cardExp: "07/29",
      subscriptionId: sub ? `sub_s_${id.slice(-8)}` : "", subscriptionStatus: sub ? "active" : "",
      interval: sub ? "month" : "", intervalCount: 1, quantity: 1, invoiceId: sub ? `in_s_${id.slice(-8)}` : "",
      productId: p.id, productName: p.name, stripePriceId: `price_s_${p.id}`,
      items: [{ description: p.name, quantity: 1, amount: amt, priceId: `price_s_${p.id}`, interval: sub ? "month" : null, intervalCount: 1 }] };
  });
}
