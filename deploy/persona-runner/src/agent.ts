import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  missionResultSchema,
  resolveLlmConfig,
  type MissionRequest,
  type MissionResult,
} from "@persona-system/shared";

const MAX_TOOL_ROUNDS = 24;

function buildSystemPrompt(mission: MissionRequest): string {
  const authBlock = mission.auth
    ? `\n## Đăng nhập\nUsername: ${mission.auth.username}\nPassword: ${mission.auth.password}\nLogin: ${mission.auth.login_url ?? mission.product_url}\nĐăng nhập trước khi đánh giá.\n`
    : "";

  return `Persona AI đánh giá sản phẩm qua Chrome DevTools MCP.\n\n## Persona\n${mission.instructions}\n\nURL: ${mission.product_url}\n${mission.focus ? `Focus: ${mission.focus}\n` : ""}${authBlock}\nRubric:\n${mission.rubric.map((r) => `- ${r}`).join("\n")}\n\nKết thúc bằng JSON thuần (tiếng Việt) với persona_id, product_url, summary, scores, findings, quotes, evidence, completed_at.`;
}

function mcpToolToOpenAI(tool: {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? tool.name,
      parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("Model response did not contain JSON");
}

async function callMcpTool(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const parts = Array.isArray(result.content) ? result.content : [];
  return parts
    .map((part: { type?: string; text?: string }) =>
      part.type === "text" ? (part.text ?? "") : JSON.stringify(part),
    )
    .join("\n");
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => ("text" in part ? String(part.text ?? "") : ""))
      .join("\n");
  }
  return "";
}

export async function runMission(mission: MissionRequest): Promise<MissionResult> {
  const mcpUrl = process.env.MCP_HTTP_URL ?? "http://127.0.0.1:9223/mcp";
  const mcp = new Client({ name: "persona-runner", version: "0.1.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));

  const llm = await resolveLlmConfig();
  const openai = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
  });
  const model = llm.model;

  try {
    const listed = await mcp.listTools();
    const tools: ChatCompletionTool[] = (listed.tools ?? []).map(mcpToolToOpenAI);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(mission) },
      { role: "user", content: `Đánh giá ${mission.product_url} bằng browser tools, rồi trả JSON.` },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? "auto" : undefined,
      });

      const assistant = completion.choices[0]?.message;
      if (!assistant) throw new Error("Empty LLM response");
      messages.push(assistant);

      if (assistant.tool_calls?.length) {
        for (const call of assistant.tool_calls) {
          if (call.type !== "function") continue;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: (await callMcpTool(mcp, call.function.name, parsedArgs)).slice(0, 120_000),
          });
        }
        continue;
      }

      const text = assistantText(assistant.content);

      return missionResultSchema.parse({
        ...(extractJson(text) as Record<string, unknown>),
        persona_id: mission.persona_id,
        product_url: mission.product_url,
        completed_at: new Date().toISOString(),
      });
    }

    throw new Error(`Exceeded max tool rounds (${MAX_TOOL_ROUNDS})`);
  } finally {
    await mcp.close();
  }
}
