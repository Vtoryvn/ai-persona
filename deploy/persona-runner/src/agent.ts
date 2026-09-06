import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  missionResultSchema,
  resolveLlmConfig,
  type MissionEvent,
  type MissionRequest,
  type MissionResult,
} from "@persona-system/shared";

const MAX_TOOL_ROUNDS = 32;
const SCREENSHOT_TOOLS = /screenshot|snapshot|navigate|click|fill|type|press|scroll|wait/i;

export type MissionEventHandler = (event: MissionEvent) => void | Promise<void>;

function now() {
  return new Date().toISOString();
}

function emit(
  onEvent: MissionEventHandler | undefined,
  event: Omit<MissionEvent, "at"> & { at?: string },
) {
  return onEvent?.({ at: now(), ...event });
}

function buildSystemPrompt(mission: MissionRequest): string {
  const rubric = mission.rubric?.length
    ? `\nTiêu chí gợi ý: ${mission.rubric.join(", ")}.\n`
    : "";

  return `Bạn là một persona AI, đang dùng Chrome trên máy ảo để hoàn thành nhiệm vụ.

## Persona
${mission.instructions}

${rubric}
## Cách làm
- Dùng browser tools để khám phá, click, điền form, chụp màn hình.
- Làm như người dùng thật, từng bước.
- Khi xong, trả lời bằng tiếng Việt, tự do: nhận xét, phát hiện, đề xuất. Không bắt buộc JSON.
- Nếu muốn có cấu trúc, có thể kèm JSON ở cuối nhưng phần chính là văn bản.`;
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

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => ("text" in part ? String(part.text ?? "") : "")).join("\n");
  }
  return "";
}

interface ToolOutput {
  text: string;
  images: { mime: string; data: string }[];
}

function parseToolResult(result: unknown): ToolOutput {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const parts = Array.isArray(record.content) ? record.content : [];
  const images: { mime: string; data: string }[] = [];
  const texts: string[] = [];

  for (const part of parts as Array<Record<string, unknown>>) {
    if (part.type === "image" && typeof part.data === "string") {
      images.push({
        mime: typeof part.mimeType === "string" ? part.mimeType : "image/png",
        data: part.data,
      });
    } else if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      const match = part.text.match(/data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/);
      if (match) images.push({ mime: match[1], data: match[2] });
    } else {
      texts.push(JSON.stringify(part));
    }
  }

  return { text: texts.join("\n"), images };
}

async function callMcpTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const result = await client.callTool({ name, arguments: args });
  return parseToolResult(result);
}

function buildMcpTransport(mission: MissionRequest): StdioClientTransport {
  const viewport = mission.browser?.viewport ?? process.env.MCP_VIEWPORT ?? "1280x720";
  const args = [
    "--yes",
    "chrome-devtools-mcp@latest",
    "--headless",
    "--isolated",
    "--viewport",
    viewport,
    "--no-usage-statistics",
    "--screenshotFormat=jpeg",
    "--screenshotQuality=55",
    "--screenshotMaxWidth=1280",
    "--chromeArg=--no-sandbox",
    "--chromeArg=--disable-setuid-sandbox",
    "--chromeArg=--disable-dev-shm-usage",
  ];
  if (process.env.CHROME_EXECUTABLE) {
    args.push("--executablePath", process.env.CHROME_EXECUTABLE);
  }
  return new StdioClientTransport({
    command: "npx",
    args,
    env: { ...process.env } as Record<string, string>,
    stderr: "inherit",
  });
}

function findScreenshotTool(tools: ChatCompletionTool[]): string | undefined {
  const names = tools.map((t) => t.function.name);
  return names.find((n) => /take_screenshot|screenshot/i.test(n));
}

function toMissionResult(mission: MissionRequest, text: string): MissionResult {
  const trimmed = text.trim();
  try {
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      const response =
        (typeof parsed.response === "string" && parsed.response) ||
        (typeof parsed.summary === "string" && parsed.summary) ||
        trimmed;
      return missionResultSchema.parse({
        ...parsed,
        persona_id: mission.persona_id,
        prompt: mission.prompt,
        product_url: mission.product_url,
        response,
        completed_at: new Date().toISOString(),
      });
    }
  } catch {
    // freeform
  }

  return missionResultSchema.parse({
    persona_id: mission.persona_id,
    prompt: mission.prompt,
    product_url: mission.product_url,
    response: trimmed,
    summary: trimmed.slice(0, 280),
    completed_at: new Date().toISOString(),
  });
}

export async function runMission(
  mission: MissionRequest,
  onEvent?: MissionEventHandler,
): Promise<MissionResult> {
  await emit(onEvent, { type: "status", personaId: mission.persona_id, message: "Khởi động Chrome trên máy ảo..." });

  const mcp = new Client({ name: "persona-runner", version: "0.1.0" });
  await mcp.connect(buildMcpTransport(mission));

  const llm = await resolveLlmConfig();
  const openai = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
  });
  const model = llm.model;

  try {
    await emit(onEvent, { type: "status", personaId: mission.persona_id, message: "Chrome sẵn sàng — bắt đầu nhiệm vụ" });
    const listed = await mcp.listTools();
    const tools: ChatCompletionTool[] = (listed.tools ?? []).map(mcpToolToOpenAI);
    const screenshotTool = findScreenshotTool(tools);

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(mission) },
      { role: "user", content: mission.prompt },
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

      const thought = assistantText(assistant.content).trim();
      if (thought) {
        await emit(onEvent, { type: "thought", personaId: mission.persona_id, text: thought });
      }

      if (assistant.tool_calls?.length) {
        for (const call of assistant.tool_calls) {
          if (call.type !== "function") continue;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          await emit(onEvent, {
            type: "tool",
            personaId: mission.persona_id,
            name: call.function.name,
            args: parsedArgs,
            message: call.function.name,
          });

          const output = await callMcpTool(mcp, call.function.name, parsedArgs);
          for (const image of output.images) {
            await emit(onEvent, {
              type: "screenshot",
              personaId: mission.persona_id,
              mime: image.mime,
              data: image.data,
              caption: call.function.name,
            });
          }

          if (!output.images.length && screenshotTool && SCREENSHOT_TOOLS.test(call.function.name)) {
            try {
              const shot = await callMcpTool(mcp, screenshotTool, {});
              for (const image of shot.images) {
                await emit(onEvent, {
                  type: "screenshot",
                  personaId: mission.persona_id,
                  mime: image.mime,
                  data: image.data,
                  caption: screenshotTool,
                });
              }
            } catch {
              // screenshot is best-effort
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: output.text.slice(0, 80_000),
          });
        }
        continue;
      }

      const result = toMissionResult(mission, thought || assistantText(assistant.content));
      await emit(onEvent, { type: "result", personaId: mission.persona_id, result, text: result.response });
      return result;
    }

    throw new Error(`Exceeded max tool rounds (${MAX_TOOL_ROUNDS})`);
  } catch (error) {
    await emit(onEvent, {
      type: "error",
      personaId: mission.persona_id,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await mcp.close();
  }
}
