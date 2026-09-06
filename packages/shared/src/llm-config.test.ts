import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProjectEnv, maskApiKey, resolveLlmConfig } from "./llm-config.js";

test("maskApiKey hides middle of key", () => {
  assert.equal(maskApiKey("sk-1234567890abcdef"), "sk-1••••cdef");
});

test("resolveLlmConfig reads project .env", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "persona-"));
  await writeFile(
    path.join(dir, ".env"),
    "LLM_BASE_URL=https://llm.test/v1\nLLM_API_KEY=sk-test-key\nLLM_MODEL=gpt-4o-mini\n",
    "utf8",
  );

  const config = await resolveLlmConfig({ repoRoot: dir, env: {} });
  assert.equal(config.baseUrl, "https://llm.test/v1");
  assert.equal(config.apiKey, "sk-test-key");
  assert.equal(config.model, "gpt-4o-mini");
  assert.match(config.source, /\.env/);
});

test("loadProjectEnv does not override existing env", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "persona-"));
  await writeFile(path.join(dir, ".env"), "LLM_API_KEY=from-file\n", "utf8");
  const env = { LLM_API_KEY: "from-process" };
  await loadProjectEnv(dir, env);
  assert.equal(env.LLM_API_KEY, "from-process");
});
