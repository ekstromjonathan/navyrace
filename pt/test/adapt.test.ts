import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferModality,
  isExtraWording,
  isHeavyDose,
  looksLikeActivityReport,
  parseDistanceKm,
  parseDurationMinutes,
  sameFamily,
  stacksHard,
} from "../src/activity.ts";
import { adaptAfterLog } from "../src/adapt.ts";
import { assignSessionDays } from "../src/calendar.ts";
import type { Plan } from "../src/types.ts";

describe("activity", () => {
  it("maps sports and dose", () => {
    assert.equal(inferModality("spilte tennis i 2 timer"), "racket");
    assert.equal(inferModality("padlet 2 timer"), "paddle");
    assert.equal(inferModality("Løping med fartslek"), "run");
    assert.equal(inferModality("Styrke for hele kroppen"), "strength");
    assert.equal(parseDurationMinutes("padling 2 timer"), 120);
    assert.equal(parseDistanceKm("Løp 7k"), 7);
    assert.equal(isHeavyDose("padlet 2 timer"), true);
    assert.equal(isHeavyDose("løp 5 km"), false);
    assert.equal(sameFamily("run", "racket"), true);
    assert.equal(sameFamily("run", "paddle"), false);
    assert.equal(stacksHard("run", "racket"), true);
    assert.equal(stacksHard("paddle", "climb"), false);
    assert.equal(looksLikeActivityReport("Løp 7k"), true);
    assert.equal(isExtraWording("trente tennis i tillegg"), true);
  });
});

describe("adaptAfterLog", () => {
  const week2 = (): Plan =>
    assignSessionDays({
      weeks: 2,
      daysPerWeek: 4,
      startedOn: "2026-08-15",
      sessions: [
        { id: "w2d1", week: 2, title: "Styrke for hele kroppen", loadKey: "styrke", load: 4, unit: "runder" },
        { id: "w2d2", week: 2, title: "Løping med fartslek", loadKey: "loping", load: 9, unit: "kilometer" },
        { id: "w2d3", week: 2, title: "Klatring og grep", loadKey: "klatring", load: 45, unit: "minutter" },
        { id: "w2d4", week: 2, title: "Kajakk med tak i rykk", loadKey: "padling", load: 45, unit: "minutter" },
      ],
    });

  it("swaps the next run when they already ran on a strength day", () => {
    const plan = week2();
    const result = adaptAfterLog(plan, {
      startedOn: "2026-08-15",
      loggedOnYmd: "2026-08-17", // Monday week 2
      planned: plan.sessions.find((s) => s.id === "w2d1") ?? null,
      actualText: "Løp 7k",
      actualModality: "run",
    });
    assert.equal(result.changed, true);
    const tue = result.plan.sessions.find((s) => s.id === "w2d2");
    assert.match(tue?.title ?? "", /styrke/i);
  });

  it("eases the later paddle when they paddle 2h on a fartlek day", () => {
    const plan = week2();
    const result = adaptAfterLog(plan, {
      startedOn: "2026-08-15",
      loggedOnYmd: "2026-08-18", // Tuesday
      planned: plan.sessions.find((s) => s.id === "w2d2") ?? null,
      actualText: "Padlet 2 timer",
      actualModality: "paddle",
    });
    assert.equal(result.changed, true);
    const satLoad = result.plan.sessions.find((s) => s.id === "w2d4")?.load ?? 99;
    assert.ok(satLoad < 45);
    assert.match(result.summaryNb, /letter/i);
    const again = adaptAfterLog(result.plan, {
      startedOn: "2026-08-15",
      loggedOnYmd: "2026-08-18",
      planned: plan.sessions.find((s) => s.id === "w2d2") ?? null,
      actualText: "Padlet 2 timer",
      actualModality: "paddle",
    });
    assert.equal(again.changed, false);
    assert.equal(again.plan.sessions.find((s) => s.id === "w2d4")?.load, satLoad);
  });

  it("treats tennis as filling a run slot and eases the next impact-ish day if heavy", () => {
    const plan = week2();
    const result = adaptAfterLog(plan, {
      startedOn: "2026-08-15",
      loggedOnYmd: "2026-08-18",
      planned: plan.sessions.find((s) => s.id === "w2d2") ?? null,
      actualText: "spilte tennis i 2 timer",
      actualModality: "racket",
    });
    assert.equal(result.changed, true);
  });
});
