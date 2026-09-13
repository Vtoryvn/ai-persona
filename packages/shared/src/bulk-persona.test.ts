import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonaFromBulkRow, findDuplicateBulkIds } from "./bulk-persona.js";

test("buildPersonaFromBulkRow applies defaults and derives fly app", () => {
  const persona = buildPersonaFromBulkRow(
    {
      id: "skeptic",
      name: "Skeptic",
      description: "Hoài nghi",
      instructions: "Bạn là người dùng hoài nghi...",
    },
    {},
  );
  assert.equal(persona.id, "skeptic");
  assert.equal(persona.fly.app, "persona-skeptic");
  assert.equal(persona.browser?.viewport, "1280x720");
  assert.equal(persona.browser?.locale, "vi-VN");
  assert.equal(persona.fly.region, "sin");
  assert.deepEqual(persona.evaluation?.rubric, ["clarity", "usability"]);
});

test("buildPersonaFromBulkRow uses provided defaults", () => {
  const persona = buildPersonaFromBulkRow(
    {
      id: "mobile",
      name: "Mobile",
      description: "Mobile user",
      instructions: "Instructions...",
    },
    {
      browser: { viewport: "390x844", locale: "en-US" },
      fly: { region: "nrt" },
      evaluation: { rubric: ["mobile_fit"], output_format: "json" },
    },
  );
  assert.equal(persona.browser?.viewport, "390x844");
  assert.equal(persona.fly.region, "nrt");
  assert.deepEqual(persona.evaluation?.rubric, ["mobile_fit"]);
});

test("findDuplicateBulkIds returns repeated ids", () => {
  assert.deepEqual(
    findDuplicateBulkIds([
      { id: "a", name: "A", description: "d", instructions: "i" },
      { id: "b", name: "B", description: "d", instructions: "i" },
      { id: "a", name: "A2", description: "d", instructions: "i" },
    ]),
    ["a"],
  );
});
