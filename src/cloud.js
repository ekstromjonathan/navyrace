/* --------------------------- optional cloud sync --------------------------- */
/* Supabase sync for progress across devices. Entirely optional: without the    */
/* two env vars `enabled` is false, every call below is a no-op, and the app    */
/* runs exactly as it does on localStorage alone.                               */

const URL = import.meta.env?.VITE_SUPABASE_URL || (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL);
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY || (typeof process !== "undefined" && process.env?.VITE_SUPABASE_ANON_KEY);

export const enabled = Boolean(URL && ANON);

export const TABLE = "navyrace_progress";

let clientPromise = null;
function getClient() {
  if (!enabled) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(URL, ANON)
    );
  }
  return clientPromise;
}

export function __setClient(c) { clientPromise = Promise.resolve(c); }

export function newer(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;
}

export async function getUser() {
  const sb = await getClient();
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export function onAuthChange(cb) {
  let stop = null, cancelled = false;
  getClient().then((sb) => {
    if (!sb || cancelled) return;
    const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session?.user ?? null));
    stop = () => data.subscription.unsubscribe();
  }).catch(() => {});
  return () => { cancelled = true; if (stop) stop(); };
}

export async function sendMagicLink(email) {
  const sb = await getClient();
  if (!sb) throw new Error("Sky-synk er ikke konfigurert.");
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

function rowToState(data) {
  if (!data) return null;
  return {
    index: data.session_index ?? 0,
    logs: data.logs ?? {},
    profile: data.profile ?? null,
    program: data.program ?? null,
    updatedAt: Date.parse(data.updated_at) || 0,
  };
}

export async function pull(userId) {
  const sb = await getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from(TABLE)
    .select("session_index, logs, profile, program, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return rowToState(data);
}

/** Full-row upsert. Always send profile + program so LWW stays consistent. */
export async function push(userId, state) {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.from(TABLE).upsert(
    {
      user_id: userId,
      session_index: state.index,
      logs: state.logs,
      profile: state.profile ?? null,
      program: state.program ?? null,
      updated_at: new Date(state.updatedAt ?? Date.now()).toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

/** Pull-then-push for rare profile writes (B4 damping). */
export async function pushProfile(userId, local) {
  const remote = await pull(userId);
  const base = newer(local, remote) || local;
  const merged = {
    ...base,
    profile: local.profile,
    program: local.program !== undefined ? local.program : base.program,
    updatedAt: Date.now(),
  };
  await push(userId, merged);
  return merged;
}
