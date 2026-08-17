import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignSessionDays,
  buildDayView,
  stampPlanOnActivate,
  trainDaysFor,
  weekNumber,
  weekdayMon0,
} from "../src/calendar.ts";
import type { Plan } from "../src/types.ts";

describe("calendar", () => {
  it("maps ISO dates to Monday=0 weekdays", () => {
    assert.equal(weekdayMon0("2026-08-17"), 0); // Monday
    assert.equal(weekdayMon0("2026-08-18"), 1);
    assert.equal(weekdayMon0("2026-08-23"), 6); // Sunday
  });

  it("counts weeks from the Monday of the start week", () => {
    assert.equal(weekNumber("2026-08-17", "2026-08-17"), 1);
    assert.equal(weekNumber("2026-08-19", "2026-08-17"), 1); // Wed start still week 1 that Monday
    assert.equal(weekNumber("2026-08-17", "2026-08-24"), 2);
  });

  it("spreads training days and leaves rest days empty", () => {
    assert.deepEqual(trainDaysFor(3), [0, 2, 4]);
    const plan: Plan = {
      daysPerWeek: 3,
      weeks: 2,
      sessions: [
        { id: "w1d1", week: 1, title: "Styrke" },
        { id: "w1d2", week: 1, title: "Løp" },
        { id: "w1d3", week: 1, title: "Langtur" },
        { id: "w2d1", week: 2, title: "Styrke 2" },
      ],
    };
    const assigned = assignSessionDays(plan);
    assert.equal(assigned.sessions[0]?.day, 0);
    assert.equal(assigned.sessions[1]?.day, 2);
    assert.equal(assigned.sessions[2]?.day, 4);
    assert.equal(assigned.sessions[3]?.day, 0);
  });

  it("treats today as rest instead of the next unlogged session", () => {
    const plan = stampPlanOnActivate(
      {
        daysPerWeek: 3,
        weeks: 1,
        sessions: [
          { id: "w1a", week: 1, title: "Styrke" },
          { id: "w1b", week: 1, title: "Intervall" },
          { id: "w1c", week: 1, title: "Langtur" },
        ],
      },
      "2026-08-17",
    )!;
    const tue = buildDayView(plan, [], "2026-08-18", plan.startedOn!);
    assert.equal(tue.kind, "rest");
    const mon = buildDayView(plan, [], "2026-08-17", plan.startedOn!);
    assert.equal(mon.kind, "session");
    if (mon.kind === "session") assert.equal(mon.session.title, "Styrke");
    const monDone = buildDayView(plan, ["w1a"], "2026-08-17", plan.startedOn!);
    assert.equal(monDone.kind, "logged");
    const wed = buildDayView(plan, ["w1a"], "2026-08-19", plan.startedOn!);
    assert.equal(wed.kind, "session");
    if (wed.kind === "session") assert.equal(wed.session.title, "Intervall");
  });
});
