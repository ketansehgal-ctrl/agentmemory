import type Anthropic from "@anthropic-ai/sdk";
import type { Project } from "../src/projects.js";
import type { GeneratedApp } from "../src/schema.js";

export function sampleApp(overrides: Partial<GeneratedApp> = {}): GeneratedApp {
  return {
    appName: "Darjeeling Tea",
    primaryColor: "#1f6f4a",
    summary: "Your tea catalogue is ready with a quote form and a WhatsApp button.",
    dependencies: ["@react-navigation/native-stack", "@expo/vector-icons"],
    files: [
      { path: "App.js", contents: "export default function App() { return null; }\n" },
      { path: "src/screens/Home.js", contents: "export default function Home() { return null; }\n" },
    ],
    ...overrides,
  };
}

export function sampleProject(overrides: Partial<Project> = {}): Project {
  const app = sampleApp();
  return {
    id: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    status: "ready",
    appName: app.appName,
    primaryColor: "#1F6F4A",
    files: app.files,
    dependencies: app.dependencies,
    chat: [{ from: "client", text: "A tea catalogue app", at: "2026-10-10T00:00:00.000Z" }],
    builds: [],
    ...overrides,
  };
}

export function messageWith(
  text: string,
  stop_reason: Anthropic.Beta.Messages.BetaMessage["stop_reason"] = "end_turn",
): Anthropic.Beta.Messages.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason,
    stop_sequence: null,
  } as unknown as Anthropic.Beta.Messages.BetaMessage;
}
