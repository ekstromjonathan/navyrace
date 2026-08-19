import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coachQualityIssues } from "../src/coach-contract.ts";
import { detectSafetyRoute } from "../src/safety.ts";
import { COACH_SCENARIOS } from "./fixtures/coach-scenarios.ts";

describe("coach quality contract", () => {
  for (const scenario of COACH_SCENARIOS) {
    it(`keeps ${scenario.id} autonomous, specific, and concise`, () => {
      assert.deepEqual(coachQualityIssues(scenario.exemplar), []);
      for (const required of scenario.required) {
        assert.match(scenario.exemplar, required);
      }
      for (const forbidden of scenario.forbidden) {
        assert.doesNotMatch(scenario.exemplar, forbidden);
      }
    });
  }

  it("flags deterministic anti-patterns", () => {
    assert.deepEqual(coachQualityIssues(""), ["empty"]);
    assert.ok(coachQualityIssues("Du er lat. Ingen unnskyldning.").includes("shaming_language"));
    assert.ok(
      coachQualityIssues("Det er helt trygt å fortsette. Ingen grunn til bekymring.").includes(
        "medical_certainty",
      ),
    );
    assert.ok(coachQualityIssues("Skal du trene? Når passer det?").includes("too_many_questions"));
    assert.ok(coachQualityIssues("x".repeat(1201)).includes("too_long"));
  });
});

describe("deterministic safety routing", () => {
  it("routes explicit exercise red flags outside the model", () => {
    assert.deepEqual(detectSafetyRoute("Jeg fikk trykk i brystet under løpeturen"), {
      kind: "cardiorespiratory",
      signal: "chest-discomfort",
    });
    assert.deepEqual(detectSafetyRoute("I fainted after the interval"), {
      kind: "cardiorespiratory",
      signal: "fainting",
    });
    assert.deepEqual(detectSafetyRoute("Jag kan inte belasta foten"), {
      kind: "serious_injury",
      signal: "cannot-bear-weight",
    });
    assert.deepEqual(detectSafetyRoute("Jeg vil ta livet mitt"), {
      kind: "mental_crisis",
      signal: "self-harm",
    });
  });

  it("does not route negated symptoms or exercise names", () => {
    assert.equal(detectSafetyRoute("Jeg har ikke brystsmerter"), null);
    assert.equal(detectSafetyRoute("Jeg har ikke hatt brystsmerter"), null);
    assert.equal(detectSafetyRoute("Er brystpress 4 x 8 en god øvelse?"), null);
    assert.equal(detectSafetyRoute("Vanlig stølhet etter knebøy"), null);
  });
});
