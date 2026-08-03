/* RPE adaptation — sessions array injected (never module-global SESSIONS).
   withLoad rewrites dose from session data only — never WK/buildDay. */

export const RPE = {
  lett:    { mult: 1.08, color: "var(--go)",   label: "Lett",    msg: "Forrige føltes lett — skrur opp litt." },
  passe:   { mult: 1.0,  color: "var(--hold)", label: "Passe",   msg: "Holder planen." },
  brutalt: { mult: 0.9,  color: "var(--hard)", label: "Brutalt", msg: "Forrige var hard — letter litt." },
};

export const SKIPPED = "hoppet";

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace whole-number occurrences of oldLoad with newLoad in a detail string. */
export function rewriteDose(text, oldLoad, newLoad) {
  if (text == null || oldLoad == null || newLoad == null) return text;
  if (oldLoad === newLoad) return text;
  return String(text).replace(new RegExp(`\\b${escapeRe(oldLoad)}\\b`, "g"), String(newLoad));
}

/**
 * Display-only: apply adapted load onto a session copy.
 * Uses session.estFromLoad(load) when present; otherwise rewrites numeric tokens.
 */
export function withLoad(session, load) {
  if (!session || load == null || load === session.load) return session;
  const oldLoad = session.load;
  const items = (session.items || []).map((it) => ({
    ...it,
    detail: rewriteDose(it.detail, oldLoad, load),
  }));
  let est = session.est;
  if (typeof session.estFromLoad === "function") {
    est = session.estFromLoad(load);
  } else {
    est = rewriteDose(est, oldLoad, load);
  }
  return { ...session, load, items, est };
}

/** Find prior RPE for same loadKey by walking the user's sessions array. */
export function adapt(session, index, logs, sessions) {
  if (!session || session.load == null) return { load: null, note: null };
  const list = sessions || [];
  let prev = null;
  for (let i = index - 1; i >= 0; i--) {
    const s = list[i];
    if (!s) continue;
    if (s.loadKey === session.loadKey && RPE[logs[s.id]]) {
      prev = logs[s.id];
      break;
    }
  }
  if (!prev) return { load: session.load, note: null };
  const r = RPE[prev];
  let v = session.load * r.mult;
  v = session.unit === "km" ? Math.round(v * 2) / 2 : Math.round(v);
  const note = v !== session.load ? r.msg : null;
  return { load: v, note, dir: v > session.load ? "up" : v < session.load ? "down" : "flat" };
}
