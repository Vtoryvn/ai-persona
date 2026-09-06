import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { maskApiKey, resolveLlmConfig } from "./lumen-llm.js";

test("maskApiKey hides middle of key", () => {
  assert.equal(maskApiKey("sk-1234567890abcdef"), "sk-1••••cdef");
});

test("resolveLlmConfig reads lumen .env.local", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lumen-"));
  await writeFile(
    path.join(dir, ".env.local"),
    "OPENAI_BASE_URL=https://llm.test/v1\nOPENAI_API_KEY=sk-test-key\n",
    "utf8",
  );

  const config = await resolveLlmConfig({
    lumenProjectPath: dir,
    env: {},
  });

  assert.equal(config.baseUrl, "https://llm.test/v1");
  assert.equal(config.apiKey, "sk-test-key");
  assert.match(config.source, /lumen/);
});
