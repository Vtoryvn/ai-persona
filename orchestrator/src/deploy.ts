import { spawn } from "node:child_process";
import path from "node:path";
import { loadPersonasDir } from "@persona-system/shared";

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function deployPersonas(options: {
  personasDir: string;
  personaIds?: string[];
  repoRoot: string;
}): Promise<void> {
  const all = await loadPersonasDir(options.personasDir);
  const selected = options.personaIds?.length
    ? all.filter((p) => options.personaIds!.includes(p.id))
    : all;

  for (const persona of selected) {
    process.stderr.write(`\nDeploying ${persona.fly.app} (${persona.id})...\n`);
    const flyToml = path.join(options.repoRoot, "deploy", "persona-runner", "fly.toml");
    const example = path.join(options.repoRoot, "deploy", "persona-runner", "fly.toml.example");

    const { readFile, writeFile } = await import("node:fs/promises");
    let template = await readFile(example, "utf8");
    template = template
      .replace(/app = "[^"]+"/, `app = "${persona.fly.app}"`)
      .replace(/primary_region = "[^"]+"/, `primary_region = "${persona.fly.region}"`)
      .replace(/PERSONA_ID = "[^"]+"/, `PERSONA_ID = "${persona.id}"`);

    const viewport = persona.browser?.viewport ?? "1280x720";
    template = template.replace(/MCP_VIEWPORT = "[^"]+"/, `MCP_VIEWPORT = "${viewport}"`);

    await writeFile(flyToml, template, "utf8");

    let code = await run("fly", ["apps", "create", persona.fly.app, "--yes"], options.repoRoot);
    if (code !== 0) process.stderr.write(`(app may already exist, continuing)\n`);

    code = await run(
      "fly",
      ["deploy", "--config", flyToml, "--dockerfile", "deploy/persona-runner/Dockerfile"],
      options.repoRoot,
    );
    if (code !== 0) throw new Error(`Deploy failed for ${persona.id} (exit ${code})`);
  }
}
