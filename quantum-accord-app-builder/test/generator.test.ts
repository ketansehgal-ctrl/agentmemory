import { describe, expect, it, vi } from "vitest";
import { ClaudeAppGenerator, GenerationError, type StreamMessage } from "../src/generator.js";
import { messageWith, sampleApp, sampleChange } from "./helpers.js";

function fakeStream(...messages: ReturnType<typeof messageWith>[]) {
  const calls: Parameters<StreamMessage>[0][] = [];
  const stream: StreamMessage = vi.fn((params) => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const next = messages.shift();
    if (!next) throw new Error("unexpected extra call");
    return { finalMessage: async () => next };
  });
  return { stream, calls };
}

describe("ClaudeAppGenerator", () => {
  it("requests a structured app from Claude and normalizes the result", async () => {
    const { stream, calls } = fakeStream(messageWith(JSON.stringify(sampleApp())));
    const app = await new ClaudeAppGenerator(stream, "claude-opus-5-5").generate({ request: "A tea catalogue app" });

    expect(app.primaryColor).toBe("#1F6F4A");
    expect(app.dependencies).toEqual(["@expo/vector-icons", "@react-navigation/native-stack"]);
    expect(calls).toHaveLength(1);
    const params = calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config?.effort).toBe("high");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
    expect(JSON.stringify(params.messages)).toContain("A tea catalogue app");
  });

  it("sends the current files when the client asks for a change", async () => {
    const { stream, calls } = fakeStream(messageWith(JSON.stringify(sampleChange())));
    await new ClaudeAppGenerator(stream, "claude-opus-5-5", () => {}).generate({
      request: "Make the buttons gold",
      current: sampleApp(),
      earlierRequests: ["A tea catalogue app"],
    });
    const prompt = JSON.stringify(calls[0]!.messages);
    expect(prompt).toContain("Make the buttons gold");
    expect(prompt).toContain("src/screens/Home.js");
    expect(prompt).toContain("A tea catalogue app");
    expect(JSON.stringify(calls[0]!.output_config?.format)).toContain("deletedFiles");
  });

  it("merges a change into the current app: edits replace, new files add, deletions remove", async () => {
    const current = sampleApp({
      files: [
        { path: "App.js", contents: "old app" },
        { path: "src/screens/Home.js", contents: "home" },
        { path: "src/screens/Old.js", contents: "old screen" },
      ],
    });
    const change = sampleChange({
      files: [
        { path: "App.js", contents: "gold app" },
        { path: "src/screens/Certificates.js", contents: "certificates" },
      ],
      deletedFiles: ["src/screens/Old.js", "src/never-existed.js"],
    });
    const { stream } = fakeStream(messageWith(JSON.stringify(change)));
    const app = await new ClaudeAppGenerator(stream, "claude-opus-5-5", () => {}).generate({
      request: "Add a certificates screen and make it gold",
      current,
    });

    expect(app.files).toEqual([
      { path: "App.js", contents: "gold app" },
      { path: "src/screens/Certificates.js", contents: "certificates" },
      { path: "src/screens/Home.js", contents: "home" },
    ]);
    expect(app.summary).toBe(change.summary);
  });

  it("asks for a corrected change when a change would break the app", async () => {
    const breaking = sampleChange({ files: [], deletedFiles: ["App.js"] });
    const { stream, calls } = fakeStream(messageWith(JSON.stringify(breaking)), messageWith(JSON.stringify(sampleChange())));
    const app = await new ClaudeAppGenerator(stream, "claude-opus-5-5", () => {}).generate({
      request: "Remove the home screen",
      current: sampleApp(),
    });

    expect(app.files.map((f) => f.path)).toContain("App.js");
    const retry = JSON.stringify(calls[1]!.messages[2]);
    expect(retry).toContain("App.js is missing.");
    expect(retry).toContain("only the files you add or change");
  });

  it("logs Claude token usage for each request", async () => {
    const message = messageWith(JSON.stringify(sampleApp()));
    (message as { usage: unknown }).usage = { input_tokens: 2100, output_tokens: 31000, cache_read_input_tokens: 1800 };
    const { stream } = fakeStream(message);
    const lines: string[] = [];
    await new ClaudeAppGenerator(stream, "claude-opus-5-5", (l) => lines.push(l)).generate({ request: "A tea app" });
    expect(lines).toEqual(["Claude usage (new app, attempt 1): 2100 input + 1800 cached input, 31000 output tokens"]);
  });

  it("asks Claude to fix an unusable app once, appending to the conversation", async () => {
    const broken = sampleApp({ files: [{ path: "../evil.js", contents: "" }] });
    const { stream, calls } = fakeStream(messageWith(JSON.stringify(broken)), messageWith(JSON.stringify(sampleApp())));
    const app = await new ClaudeAppGenerator(stream, "claude-opus-5-5").generate({ request: "A tea catalogue app" });

    expect(app.files.map((f) => f.path)).toContain("App.js");
    expect(calls).toHaveLength(2);
    const retry = calls[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]!.role).toBe("assistant");
    expect(JSON.stringify(retry[2])).toContain("App.js is missing.");
  });

  it("gives up after a second unusable answer", async () => {
    const { stream } = fakeStream(messageWith("not json"), messageWith("still not json"));
    await expect(
      new ClaudeAppGenerator(stream, "claude-opus-5-5").generate({ request: "A tea catalogue app" }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("turns a refusal into a friendly error without retrying", async () => {
    const { stream, calls } = fakeStream(messageWith("", "refusal"));
    await expect(
      new ClaudeAppGenerator(stream, "claude-opus-5-5").generate({ request: "Something not allowed" }),
    ).rejects.toThrow(/can't be built/);
    expect(calls).toHaveLength(1);
  });
});
