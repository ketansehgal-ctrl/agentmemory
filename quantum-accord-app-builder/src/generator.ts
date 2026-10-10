import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import type { z } from "zod";
import { buildUserMessage, SYSTEM_PROMPT, type CurrentApp } from "./prompts.js";
import {
  AppChangeSchema,
  applyAppChange,
  findAppProblems,
  GeneratedAppSchema,
  type GeneratedApp,
} from "./schema.js";

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

/**
 * New apps come back whole. Change requests come back as only the added, edited and
 * deleted files, which are merged into the current app: far fewer output tokens per change.
 */
export class ClaudeAppGenerator implements AppGenerator {
  constructor(
    private readonly streamMessage: StreamMessage,
    private readonly model: string,
    private readonly log: (line: string) => void = console.log,
  ) {}

  static fromClient(client: Anthropic, model: string): ClaudeAppGenerator {
    return new ClaudeAppGenerator((params) => client.beta.messages.stream(params), model);
  }

  async generate({ request, current, earlierRequests = [] }: GenerateRequest): Promise<GeneratedApp> {
    const kind = current ? "change" : "new app";
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
        output_config: {
          effort: "high",
          format: current ? betaZodOutputFormat(AppChangeSchema) : betaZodOutputFormat(GeneratedAppSchema),
        },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      }).finalMessage();
      this.logUsage(kind, attempt, message);

      if (message.stop_reason === "refusal") {
        throw new GenerationError(
          "This request can't be built. Please describe the app differently and try again.",
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new GenerationError("This app is too large to build in one go. Try asking for fewer screens first.");
      }

      const { app, problems } = readApp(message, current);
      if (app && problems.length === 0) return normalize(app);
      if (attempt === MAX_ATTEMPTS) {
        throw new GenerationError(`The app engine returned an unusable app: ${problems.join(" ")}`);
      }
      const resend = current
        ? "return the whole corrected change, measured against the app as it was before your last answer: only the files you add or change, plus any files to delete"
        : "return the complete app again";
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `That app can't be used yet. Fix these problems and ${resend}:\n${problems
            .map((p) => `- ${p}`)
            .join("\n")}`,
        },
      );
    }
    throw new GenerationError("The app engine did not return an app.");
  }

  private logUsage(kind: string, attempt: number, message: BetaMessage): void {
    const usage = message.usage;
    if (!usage) return;
    const cached = usage.cache_read_input_tokens ?? 0;
    this.log(
      `Claude usage (${kind}, attempt ${attempt}): ${usage.input_tokens} input + ${cached} cached input, ${usage.output_tokens} output tokens`,
    );
  }
}

function readApp(message: BetaMessage, current?: CurrentApp): { app?: GeneratedApp; problems: string[] } {
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

  if (current) {
    const change = AppChangeSchema.safeParse(json);
    if (!change.success) return { problems: describeIssues(change.error) };
    const app = applyAppChange(current.files, change.data);
    return { app, problems: findAppProblems(app) };
  }
  const parsed = GeneratedAppSchema.safeParse(json);
  if (!parsed.success) return { problems: describeIssues(parsed.error) };
  return { app: parsed.data, problems: findAppProblems(parsed.data) };
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "response"}: ${i.message}`);
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
