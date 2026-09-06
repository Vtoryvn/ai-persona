#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadProjectEnv } from "@persona-system/shared";
import { deployPersonas, syncLlmSecrets } from "./deploy.js";
import { runEval } from "./eval.js";
import { writeReport } from "./report.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPersonasDir = path.join(repoRoot, "personas");

await loadProjectEnv(repoRoot);

const program = new Command();
program.name("persona").description("Persona evaluation orchestrator");

program
  .command("eval")
  .description("Run a freeform prompt against deployed persona runners")
  .requiredOption("--prompt <text>", "Freeform task prompt")
  .option("--url <productUrl>", "Optional product URL")
  .option("--personas <ids>", "Comma-separated persona ids (default: all)")
  .option("--username <user>", "Product login username")
  .option("--password <pass>", "Product login password")
  .option("--login-url <url>", "Login page URL")
  .option("--out <dir>", "Output directory")
  .action(async (opts) => {
    const personaIds = opts.personas?.split(",").map((s: string) => s.trim()).filter(Boolean);
    const { runDir, results } = await runEval({
      prompt: opts.prompt,
      productUrl: opts.url,
      personasDir: defaultPersonasDir,
      personaIds,
      username: opts.username,
      password: opts.password,
      loginUrl: opts.loginUrl,
      outDir: opts.out,
    });

    const reportPath = await writeReport(runDir, opts.prompt, results);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`Report: ${reportPath}`);
    if (failed) process.exit(1);
  });

program
  .command("deploy")
  .description("Deploy persona runners to Fly.io (one app per persona)")
  .option("--personas <ids>", "Comma-separated persona ids (default: all)")
  .action(async (opts) => {
    const personaIds = opts.personas?.split(",").map((s: string) => s.trim()).filter(Boolean);
    await deployPersonas({ personasDir: defaultPersonasDir, personaIds, repoRoot, onLog: (l) => process.stderr.write(`${l}\n`) });
  });

program
  .command("sync-secrets")
  .description("Sync LLM secrets to Fly apps from local .env")
  .option("--personas <ids>", "Comma-separated persona ids (default: all)")
  .action(async (opts) => {
    const personaIds = opts.personas?.split(",").map((s: string) => s.trim()).filter(Boolean);
    await syncLlmSecrets({ personasDir: defaultPersonasDir, personaIds, repoRoot, onLog: (l) => process.stderr.write(`${l}\n`) });
  });

program
  .command("list")
  .description("List configured personas")
  .action(async () => {
    const { loadPersonasDir, resolveRunnerUrl } = await import("@persona-system/shared");
    const personas = await loadPersonasDir(defaultPersonasDir);
    for (const p of personas) {
      console.log(`${p.id}\t${p.name}\t${resolveRunnerUrl(p)}`);
    }
  });

program.parse();
