import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { EasBuildService } from "./builds.js";
import { loadConfig } from "./config.js";
import { ClaudeAppGenerator } from "./generator.js";
import { SnackPreviewService } from "./preview.js";
import { FileProjectStore } from "./projects.js";
import { createStudioApp } from "./server.js";

const config = loadConfig();

const builds = config.expoToken
  ? new EasBuildService({
      workDir: config.workDir,
      dataDir: config.dataDir,
      expoToken: config.expoToken,
      expoOwner: config.expoOwner,
      appIdPrefix: config.appIdPrefix,
    })
  : undefined;

const { app } = createStudioApp({
  store: new FileProjectStore(path.join(config.dataDir, "projects")),
  generator: ClaudeAppGenerator.fromClient(new Anthropic(), config.claudeModel),
  preview: new SnackPreviewService(),
  builds,
  accessKey: config.accessKey,
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
});

app.listen(config.port, () => {
  console.log(`Quantum Accord App Studio on http://localhost:${config.port} (model ${config.claudeModel})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("ANTHROPIC_API_KEY is not set: app generation fails unless an `ant auth login` profile exists.");
  }
  if (!builds) console.log("EXPO_TOKEN is not set: previews work, the Build button is disabled.");
});
