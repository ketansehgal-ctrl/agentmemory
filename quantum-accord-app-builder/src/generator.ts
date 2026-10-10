import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import { buildUserMessage, SYSTEM_PROMPT, type CurrentApp } from "./prompts.js";
import { findAppProblems, GeneratedAppSchema, type GeneratedApp } from "./schema.js";

type StreamParams = BetaMessageStreamParams;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** The one SDK call the generator makes; injectable so tests can fake it. */
export type StreamMessage = (params: StreamParams) => { finalMessage(): Promise<BetaMessage> };

export class GenerationError extends Error {}

export interface GenerateRequest {
  request: string;
  current?: CurrentApp;
  earlierRequests?: string[];
}

export interface AppGenerator {
  generate(input: GenerateRequest): Promise<GeneratedApp>;
}

const MAX_ATTEMPTS = 2;

export class ClaudeAppGenerator implements AppGenerator {
  constructor(
    private readonly streamMessage: StreamMessage,
    private readonly model: string,
  ) {}

  static fromClient(client: Anthropic, model: string): ClaudeAppGenerator {
    return new ClaudeAppGenerator((params) => client.beta.messages.stream(params), model);
  }

  async generate({ request, current, earlierRequests = [] }: GenerateRequest): Promise<GeneratedApp> {
    const messages: BetaMessageParam[] = [
      { role: "user", content: buildUserMessage(request, current, earlierRequests) },
    ];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const message = await this.streamMessage({
        model: this.model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: betaZodOutputFormat(GeneratedAppSchema) },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      }).finalMessage();

      if (message.stop_reason === "refusal") {
        throw new GenerationError(
          "This request can't be built. Please describe the app differently and try again.",
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new GenerationError("This app is too large to build in one go. Try asking for fewer screens first.");
      }

      const { app, problems } = readApp(message);
      if (app && problems.length === 0) return normalize(app);
      if (attempt === MAX_ATTEMPTS) {
        throw new GenerationError(`The app engine returned an unusable app: ${problems.join(" ")}`);
      }
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `That app can't be used yet. Fix these problems and return the complete app again:\n${problems
            .map((p) => `- ${p}`)
            .join("\n")}`,
        },
      );
    }
    throw new GenerationError("The app engine did not return an app.");
  }
}

function readApp(message: BetaMessage): { app?: GeneratedApp; problems: string[] } {
  const text = message.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problems: ["The response was not valid JSON."] };
  }
  const parsed = GeneratedAppSchema.safeParse(json);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((i) => `${i.path.join(".") || "response"}: ${i.message}`) };
  }
  return { app: parsed.data, problems: findAppProblems(parsed.data) };
}

function normalize(app: GeneratedApp): GeneratedApp {
  return {
    ...app,
    appName: app.appName.trim(),
    primaryColor: app.primaryColor.toUpperCase(),
    dependencies: [...new Set(app.dependencies)].sort(),
    files: [...app.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
