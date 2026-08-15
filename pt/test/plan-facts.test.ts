import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingForPlan, readyForPlan } from "../src/plan-facts.ts";

describe("plan-facts", () => {
  it("requires goal/identity, level, days, equipment", () => {
    assert.deepEqual(missingForPlan({}), ["goal", "level", "daysPerWeek", "equipment"]);
    assert.equal(readyForPlan({}), false);
    assert.deepEqual(missingForPlan({ identity: "sprek", level: "erfaren", daysPerWeek: 4, equipment: ["kettlebell"] }), []);
    assert.equal(
      readyForPlan({ goal: "ski og OCR", level: "mye kroppsvekt", daysPerWeek: 3, equipment: ["ringer", "stang"] }),
      true,
    );
  });

  it("accepts equipment as a non-empty string", () => {
    assert.deepEqual(
      missingForPlan({ goal: "overskudd", level: "vanlig", daysPerWeek: 3, equipment: "kroppsvekt" as unknown as string[] }),
      [],
    );
  });
});
