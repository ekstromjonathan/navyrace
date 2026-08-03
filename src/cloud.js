/* --------------------------- optional cloud sync --------------------------- */
/* Supabase sync for progress across devices. Entirely optional: without the    */
/* two env vars `enabled` is false, every call below is a no-op, and the app    */
/* runs exactly as it does on localStorage alone.                               */
/*                                                                              */
/* supabase-js is imported dynamically so it stays out of the main bundle when   */
/* sync is not configured — it roughly doubles the gzipped payload otherwise.    */

/* Vite injects import.meta.env at build time; process.env lets jsdom-tests
   enable the same path with ordinary shell env vars. */
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

/* Injectable for tests — swaps the Supabase client without touching callers. */
export function __setClient(c) { clientPromise = Promise.resolve(c); }

/* ------------------------------ merge policy ------------------------------ */
/* Last write wins on updatedAt. A tie keeps local, so a device that is already
   showing the right thing never flickers to an identical remote copy. Rows
   written before sync existed have no updatedAt and count as oldest. */
export function newer(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;
}

/* -------------------------------- session -------------------------------- */
export async function getUser() {
  const sb = await getClient();
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

/* Returns an unsubscribe function synchronously; the subscription itself is
   attached once the client resolves, and is torn down even if that lands
   after the caller has already unsubscribed. */
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
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

/* --------------------------------- state --------------------------------- */
export async function pull(userId) {
  const sb = await getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from(TABLE)
    .select("session_index, logs, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    index: data.session_index ?? 0,
    logs: data.logs ?? {},
    updatedAt: Date.parse(data.updated_at) || 0,
  };
}

export async function push(userId, state) {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.from(TABLE).upsert(
    {
      user_id: userId,
      session_index: state.index,
      logs: state.logs,
      updated_at: new Date(state.updatedAt ?? Date.now()).toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}
