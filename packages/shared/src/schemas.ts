import { z } from "zod";

export const authSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  login_url: z.string().url().optional(),
  username_selector: z.string().optional(),
  password_selector: z.string().optional(),
  submit_selector: z.string().optional(),
});

export const missionRequestSchema = z.object({
  persona_id: z.string().min(1),
  product_url: z.string().url(),
  instructions: z.string().min(1),
  rubric: z.array(z.string()).min(1),
  focus: z.string().optional(),
  auth: authSchema.optional(),
  browser: z
    .object({
      viewport: z.string().optional(),
      locale: z.string().optional(),
    })
    .optional(),
});

export const findingSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  area: z.string(),
  observation: z.string(),
  suggestion: z.string(),
});

export const missionResultSchema = z.object({
  persona_id: z.string(),
  product_url: z.string().url(),
  summary: z.string(),
  scores: z.record(z.string(), z.number().min(0).max(10)),
  findings: z.array(findingSchema),
  quotes: z.array(z.string()).default([]),
  evidence: z
    .object({
      pages_visited: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional(),
  completed_at: z.string().datetime(),
});

export const personaConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  evaluation: z.object({
    rubric: z.array(z.string()).min(1),
    output_format: z.literal("json").default("json"),
  }),
  browser: z
    .object({
      viewport: z.string().optional(),
      locale: z.string().optional(),
    })
    .optional(),
  fly: z.object({
    app: z.string().min(1),
    region: z.string().default("sin"),
  }),
  runner: z
    .object({
      url: z.string().url().optional(),
    })
    .optional(),
});

export type AuthConfig = z.infer<typeof authSchema>;
export type MissionRequest = z.infer<typeof missionRequestSchema>;
export type MissionResult = z.infer<typeof missionResultSchema>;
export type PersonaConfig = z.infer<typeof personaConfigSchema>;
