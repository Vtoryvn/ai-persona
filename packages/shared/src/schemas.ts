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
  prompt: z.string().min(1),
  product_url: z.string().url().optional(),
  instructions: z.string().min(1),
  rubric: z.array(z.string()).optional(),
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
  prompt: z.string().optional(),
  product_url: z.string().optional(),
  response: z.string(),
  summary: z.string().optional(),
  scores: z.record(z.string(), z.number().min(0).max(10)).optional(),
  findings: z.array(findingSchema).optional(),
  quotes: z.array(z.string()).optional(),
  evidence: z
    .object({
      pages_visited: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional(),
  completed_at: z.string(),
});

export const missionEventSchema = z.object({
  type: z.enum(["status", "thought", "tool", "screenshot", "result", "error"]),
  at: z.string(),
  personaId: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  mime: z.string().optional(),
  data: z.string().optional(),
  caption: z.string().optional(),
  result: missionResultSchema.optional(),
});

export const personaConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  evaluation: z.object({
    rubric: z.array(z.string()).min(1).optional(),
    output_format: z.literal("json").default("json"),
  }).optional(),
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
export type MissionEvent = z.infer<typeof missionEventSchema>;
export type PersonaConfig = z.infer<typeof personaConfigSchema>;
