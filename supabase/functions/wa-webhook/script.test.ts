// Kjør: node --experimental-strip-types script.test.ts
//
// Manuset er ren logikk, så hele samtalen kan spilles uten WhatsApp, DB
// eller nett. Dette er testen som fanger at onboardingen faktisk kommer i mål.

import assert from "node:assert/strict";
import { type Profile, replyFor } from "./script.ts";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
  }
}

/** Spiller en liste med brukersvar og returnerer siste profil + alle svar. */
function play(turns: string[], start: Profile = {}) {
  let p: Profile = start;
  const replies: string[] = [];
  for (const t of turns) {
    const r = replyFor(p, t);
    p = r.next;
    replies.push(r.reply);
  }
  return { profile: p, replies };
}

const FULL_ONBOARDING = [
  "bli sterkere og orke mer i hverdagen",
  "3",
  "faste dager",
  "tir/tor/lør",
  "har trent litt",
  "kroppsvekt hjemme + kettlebell",
  "tirsdag kl 18",
  "ja",
];

console.log("\nonboarding");

check("kommer i mål og fanger alle feltene", () => {
  const { profile } = play(FULL_ONBOARDING);
  assert.equal(profile.step, "ready");
  assert.equal(profile.goal, "bli sterkere og orke mer i hverdagen");
  assert.equal(profile.days_per_week, 3);
  assert.equal(profile.mode, "calendar");
  assert.equal(profile.mode_detail, "tir/tor/lør");
  assert.equal(profile.level, "Har trent litt");
  assert.equal(profile.equipment, "kroppsvekt hjemme + kettlebell");
  assert.equal(profile.first_session, "tirsdag kl 18");
});

check("plankortet viser tilbake det brukeren sa", () => {
  const { replies } = play(FULL_ONBOARDING);
  const card = replies[6];
  assert.match(card, /Stemmer\?/);
  assert.match(card, /tir\/tor\/lør/);
  assert.match(card, /tirsdag kl 18/);
});

check("ett spørsmål per svar — aldri to spørsmålstegn", () => {
  const { replies } = play(FULL_ONBOARDING);
  for (const r of replies) {
    assert.ok((r.match(/\?/g) ?? []).length <= 1, `flere spørsmål i: ${r}`);
  }
});

check("fleksibel gren spør om tidsvindu, ikke ukedager", () => {
  const { replies } = play(["styrke", "4", "når det passer"]);
  assert.match(replies[2], /morgen|lunsj|kveld/i);
});

console.log("\nvalidering");

check("avviser dager utenfor 2–6 og blir stående", () => {
  const { profile, replies } = play(["løping", "9"]);
  assert.equal(profile.step, "q1_days");
  assert.match(replies[1], /2 og 6/);
});

check("godtar dager skrevet som setning", () => {
  const { profile } = play(["løping", "sånn ca 4 dager"]);
  assert.equal(profile.days_per_week, 4);
  assert.equal(profile.step, "q2_mode");
});

check("ukjent nivå spør om igjen i stedet for å gjette", () => {
  const { profile } = play(["styrke", "3", "faste", "man/ons", "vet ikke helt"]);
  assert.equal(profile.step, "q3_level");
  assert.equal(profile.level, undefined);
});

check("«juster» sender deg tilbake til start", () => {
  const { profile } = play([...FULL_ONBOARDING.slice(0, 7), "juster"]);
  assert.equal(profile.step, "q0_goal");
});

console.log("\nøkt");

check("start gir første øvelse og venter på ferdig", () => {
  const { profile, replies } = play([...FULL_ONBOARDING, "start"]);
  assert.equal(profile.session_kind, "full");
  assert.match(replies[8], /1\/4/);
});

check("lett gir minimumspakka", () => {
  const { profile, replies } = play([...FULL_ONBOARDING, "lett"]);
  assert.equal(profile.session_kind, "min");
  assert.match(replies[8], /push-ups/);
});

check("ferdig spør om RPE, og RPE lukker økta", () => {
  const { profile, replies } = play([...FULL_ONBOARDING, "start", "ferdig", "7"]);
  assert.equal(profile.awaiting_rpe, false);
  assert.match(replies[9], /RPE/);
  assert.match(replies[10], /Neste/);
});

check("RPE utenfor 1–10 avvises uten å lukke økta", () => {
  const { profile } = play([...FULL_ONBOARDING, "start", "ferdig", "42"]);
  assert.equal(profile.awaiting_rpe, true);
});

check("høy RPE letter neste økt, lav skrur opp", () => {
  const hard = play([...FULL_ONBOARDING, "start", "ferdig", "10"]).replies.at(-1)!;
  const easy = play([...FULL_ONBOARDING, "start", "ferdig", "2"]).replies.at(-1)!;
  assert.match(hard, /letter/i);
  assert.match(easy, /opp/i);
});

console.log("\ndårlig dag");

check("«sliten» tilbyr minimum uskyldiggjort, uten skam", () => {
  const r = play([...FULL_ONBOARDING, "er ganske sliten i dag"]).replies.at(-1)!;
  assert.match(r, /minimum/i);
  assert.doesNotMatch(r, /skuffet|dessverre|burde/i);
});

check("pause respekteres fra hvilket som helst steg", () => {
  const midt = play(["styrke", "pause"]).replies.at(-1)!;
  const etter = play([...FULL_ONBOARDING, "pause"]).replies.at(-1)!;
  assert.match(midt, /tre dager/);
  assert.match(etter, /tre dager/);
});

console.log(failures === 0 ? "\nalle tester passerte\n" : `\n${failures} feilet\n`);
process.exit(failures === 0 ? 0 : 1);
