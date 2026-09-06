import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersonaEvalResult } from "./eval.js";

function scoreTable(results: PersonaEvalResult[]): string {
  const rubrics = new Set<string>();
  for (const r of results) {
    if (r.result?.scores) {
      Object.keys(r.result.scores).forEach((k) => rubrics.add(k));
    }
  }

  const header = ["Persona", ...Array.from(rubrics)].join(" | ");
  const sep = header.replace(/[^|]/g, "-");
  const rows = results.map((r) => {
    const cells = [r.persona.name];
    for (const rubric of rubrics) {
      const score = r.result?.scores?.[rubric];
      cells.push(score !== undefined ? String(score) : r.ok ? "—" : "ERR");
    }
    return cells.join(" | ");
  });

  return [header, sep, ...rows].join("\n");
}

export async function writeReport(
  runDir: string,
  productUrl: string,
  results: PersonaEvalResult[],
): Promise<string> {
  const lines: string[] = [
    "# Persona Evaluation Report",
    "",
    `- **Product:** ${productUrl}`,
    `- **Run:** ${path.basename(runDir)}`,
    `- **Personas:** ${results.length}`,
    "",
    "## Score summary",
    "",
    scoreTable(results),
    "",
  ];

  for (const item of results) {
    lines.push(`## ${item.persona.name} (\`${item.persona.id}\`)`, "");
    if (!item.ok || !item.result) {
      lines.push(`**Failed:** ${item.error ?? "unknown"}`, "");
      continue;
    }

    const r = item.result;
    lines.push(r.summary, "", "### Findings", "");
    for (const f of r.findings) {
      lines.push(
        `- **[${f.severity}] ${f.area}:** ${f.observation} → _${f.suggestion}_`,
      );
    }
    if (r.quotes?.length) {
      lines.push("", "### Quotes", "");
      for (const q of r.quotes) lines.push(`> ${q}`);
    }
    lines.push("");
  }

  const reportPath = path.join(runDir, "report.md");
  await writeFile(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}
