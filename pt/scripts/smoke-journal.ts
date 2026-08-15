/**
 * Live Supabase smoke for PT journal queries.
 * Skips unless SUPABASE_URL + SUPABASE_SECRET_KEY (or SERVICE_ROLE) are set.
 *
 *   cd pt && npx tsx scripts/smoke-journal.ts
 */
process.env.PT_JOURNAL_BACKEND = "supabase";

import assert from "node:assert/strict";
import { initJournal, journalBackend } from "../src/db.ts";
import * as journal from "../src/journal.ts";

async function main() {
  if (!process.env.SUPABASE_URL?.trim()) {
    console.log("skip: SUPABASE_URL missing");
    process.exit(0);
  }
  if (!process.env.SUPABASE_SECRET_KEY?.trim() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.log("skip: SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY missing");
    process.exit(0);
  }

  const backend = initJournal();
  assert.equal(backend, "supabase");
  assert.equal(journalBackend(), "supabase");

  const chatId = `smoke-${Date.now()}`;
  const user = await journal.upsertUser(chatId, "+4700000000");
  console.log("upsertUser ok", user.id);

  await journal.setFacts(user.id, {
    goal: "smoke goal",
    level: "erfaren",
    daysPerWeek: 3,
    equipment: ["kettlebell", "ringer"],
    identity: "sprek",
    why: "smoke why",
  });
  const facts = journal.factsOf((await journal.getUser(user.id))!);
  assert.equal(facts.daysPerWeek, 3);
  assert.ok(Array.isArray(facts.equipment) && facts.equipment.includes("kettlebell"));
  console.log("setFacts ok");

  await journal.logMessage(user.id, "pt", "Hvor mange dager i uka?");
  await journal.logMessage(user.id, "user", "Tenker 3-4 ganger kanskje?", "smoke-days");
  await journal.logMessage(user.id, "user", "Ja, har kettlebell", "smoke-gear");

  const recent = await journal.recentChat(user.id, 24);
  assert.ok(recent.length >= 3);
  console.log("recentChat ok", recent.length);

  const recalled = await journal.recallChat(user.id, { contains: "dager", limit: 12 });
  assert.ok(recalled.some((m) => /dager/i.test(m.body)));
  assert.ok(recalled.some((m) => /3-4 ganger/i.test(m.body)));
  console.log("recallChat ok", recalled.length);

  const snap = await journal.snapshot(user);
  assert.equal(snap.readyForPlan, true);
  assert.deepEqual(snap.missingForPlan, []);
  assert.ok(snap.recentChat.length >= 3);
  console.log("snapshot ok", { readyForPlan: snap.readyForPlan, chat: snap.recentChat.length });

  await journal.addNote({ userId: user.id, trackId: null, kind: "smoke", body: "smoke note" });
  assert.equal(await journal.isFreshStart(user.id), false);
  console.log("notes/isFreshStart ok");

  // Cleanup smoke user rows (cascade).
  const { getSupabase } = await import("../src/db.ts");
  const { error } = await getSupabase().from("users").delete().eq("id", user.id);
  if (error) throw new Error(error.message);
  console.log("cleanup ok");
  console.log("SMOKE PASS");
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
