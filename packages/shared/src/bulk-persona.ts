import { personaConfigSchema, type PersonaConfig } from "./schemas.js";

export interface BulkPersonaRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface BulkPersonaDefaults {
  browser?: { viewport?: string; locale?: string };
  fly?: { region?: string };
  evaluation?: { rubric?: string[]; output_format?: "json" };
}

export function buildPersonaFromBulkRow(
  row: BulkPersonaRow,
  defaults: BulkPersonaDefaults = {},
): PersonaConfig {
  return personaConfigSchema.parse({
    id: row.id.trim(),
    name: row.name.trim(),
    description: row.description.trim(),
    instructions: row.instructions,
    evaluation: {
      rubric: defaults.evaluation?.rubric?.length
        ? defaults.evaluation.rubric
        : ["clarity", "usability"],
      output_format: "json",
    },
    browser: {
      viewport: defaults.browser?.viewport ?? "1280x720",
      locale: defaults.browser?.locale ?? "vi-VN",
    },
    fly: {
      app: `persona-${row.id.trim()}`,
      region: defaults.fly?.region ?? "sin",
    },
  });
}

export function findDuplicateBulkIds(rows: BulkPersonaRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) continue;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
