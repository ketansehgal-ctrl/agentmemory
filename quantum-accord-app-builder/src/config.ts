import path from "node:path";

export interface StudioConfig {
  port: number;
  dataDir: string;
  workDir: string;
  claudeModel: string;
  expoToken?: string;
  expoOwner?: string;
  appIdPrefix: string;
  accessKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StudioConfig {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? "data"),
    workDir: path.resolve(env.WORK_DIR ?? "work"),
    claudeModel: env.CLAUDE_MODEL || "claude-opus-5-5",
    expoToken: env.EXPO_TOKEN || undefined,
    expoOwner: env.EXPO_OWNER || undefined,
    appIdPrefix: env.APP_ID_PREFIX || "com.quantumaccord.apps",
    accessKey: env.STUDIO_ACCESS_KEY || undefined,
  };
}
