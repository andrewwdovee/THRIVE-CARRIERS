/* Alerts for whoever has the dashboard open.

   Desktop notification and chime are local to that browser. Email and text go
   out through the webhook you point at Zapier or Make — this app never holds
   mail credentials. */

let ctx = null;

export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
    // Two short notes — audible over a room without being a klaxon.
    [0, 0.16].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const t = ctx.currentTime + delay;
      osc.type = "sine";
      osc.frequency.setValueAtTime(i ? 1046.5 : 784, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.3);
    });
  } catch {
    /* No audio device, or autoplay is blocked until the page is clicked. */
  }
}

export async function askPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

export function desktop(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const n = new Notification(title, { body, tag: "fulfillment", icon: "/icon.svg" });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch { return false; }
}

/* no-cors so Zapier/Make hooks work straight from the browser. The reply is
   opaque, so a delivery failure is invisible here by design. */
export async function hook(url, payload) {
  if (!url) return false;
  try {
    await fetch(url, {
      method: "POST", mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch { return false; }
}
