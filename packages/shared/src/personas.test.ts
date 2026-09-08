import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadPersonaFile, resolveRunnerUrl, resolveNovncUrl } from "./personas.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const personaPath = path.join(repoRoot, "personas", "first-timer.yaml");

test("loadPersonaFile parses starter persona", async () => {
  const persona = await loadPersonaFile(personaPath);
  assert.equal(persona.id, "first-timer");
  assert.ok(persona.evaluation?.rubric?.includes("clarity"));
});

test("resolveRunnerUrl uses fly app", async () => {
  const persona = await loadPersonaFile(personaPath);
  assert.equal(resolveRunnerUrl(persona, {}), "https://persona-first-timer.fly.dev");
});

test("resolveNovncUrl uses fly app and noVNC port", async () => {
  const persona = await loadPersonaFile(personaPath);
  assert.equal(
    resolveNovncUrl(persona, {}),
    "https://persona-first-timer.fly.dev:6080/vnc.html?autoconnect=true&resize=scale",
  );
});
