import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersonaEvalResult } from "./eval.js";

export async function writeReport(
  runDir: string,
  prompt: string,
  results: PersonaEvalResult[],
): Promise<string> {
  const lines: string[] = [
    "# Persona Evaluation Report",
    "",
    `- **Prompt:** ${prompt.replace(/\n/g, " ").slice(0, 400)}`,
    `- **Run:** ${path.basename(runDir)}`,
    `- **Personas:** ${results.length}`,
    "",
  ];

  for (const item of results) {
    lines.push(`## ${item.persona.name} (\`${item.persona.id}\`)`, "");
    if (!item.ok || !item.result) {
      lines.push(`**Failed:** ${item.error ?? "unknown"}`, "");
      continue;
    }

    const r = item.result;
    lines.push(r.response || r.summary || "", "");
    if (r.findings?.length) {
      lines.push("### Findings", "");
      for (const f of r.findings) {
        lines.push(`- **[${f.severity}] ${f.area}:** ${f.observation} → _${f.suggestion}_`);
      }
      lines.push("");
    }
  }

  const reportPath = path.join(runDir, "report.md");
  await writeFile(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}
