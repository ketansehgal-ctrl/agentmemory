import { z } from "zod";
import { isAllowedDependency } from "./catalog.js";

export const AppFileSchema = z.object({
  path: z.string().describe("File path, either App.js or under src/, ending in .js"),
  contents: z.string().describe("Complete file contents"),
});

export const GeneratedAppSchema = z.object({
  appName: z.string().describe("Short app name shown under the icon, at most 30 characters"),
  primaryColor: z.string().describe("Main brand colour as a 6-digit hex code, e.g. #1F6F4A"),
  summary: z
    .string()
    .describe("Two or three plain-language sentences for the client about what was built or changed"),
  dependencies: z.array(z.string()).describe("Optional packages used, chosen only from the allowed list"),
  files: z.array(AppFileSchema).describe("Every file of the app, complete, including unchanged ones"),
});

/** What Claude returns for a change request: only what differs from the current app. */
export const AppChangeSchema = z.object({
  appName: z.string().describe("Short app name shown under the icon, at most 30 characters"),
  primaryColor: z.string().describe("Main brand colour as a 6-digit hex code, e.g. #1F6F4A"),
  summary: z.string().describe("Two or three plain-language sentences for the client about what changed"),
  dependencies: z.array(z.string()).describe("The full list of optional packages the app uses after the change"),
  files: z
    .array(AppFileSchema)
    .describe("Only the files you add or change, each with its complete new contents; leave out unchanged files"),
  deletedFiles: z.array(z.string()).describe("Paths of files to remove from the app; empty when none"),
});

export type AppFile = z.infer<typeof AppFileSchema>;
export type GeneratedApp = z.infer<typeof GeneratedAppSchema>;
export type AppChange = z.infer<typeof AppChangeSchema>;

/** The full app after a change: changed files replace their old versions, deleted ones go, the rest stay. */
export function applyAppChange(files: AppFile[], change: AppChange): GeneratedApp {
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const deleted of change.deletedFiles) byPath.delete(deleted);
  for (const file of change.files) byPath.set(file.path, file);
  return {
    appName: change.appName,
    primaryColor: change.primaryColor,
    summary: change.summary,
    dependencies: change.dependencies,
    files: [...byPath.values()],
  };
}

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 120_000;
const FILE_PATH = /^(App\.js|src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js)$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isSafeAppPath(filePath: string): boolean {
  return FILE_PATH.test(filePath);
}

/** Problems that make a generated app unusable; empty when it is fine. */
export function findAppProblems(app: GeneratedApp): string[] {
  const problems: string[] = [];
  const name = app.appName.trim();
  if (!name || name.length > 30) problems.push("appName must be 1-30 characters.");
  if (!HEX_COLOR.test(app.primaryColor)) problems.push("primaryColor must be a 6-digit hex code like #1F6F4A.");
  if (!app.files.some((f) => f.path === "App.js")) problems.push("App.js is missing.");
  if (app.files.length > MAX_FILES) problems.push(`Use at most ${MAX_FILES} files.`);

  const seen = new Set<string>();
  for (const file of app.files) {
    if (!isSafeAppPath(file.path)) {
      problems.push(`"${file.path}" is not allowed: use App.js or .js files under src/.`);
    }
    if (seen.has(file.path)) problems.push(`"${file.path}" appears twice.`);
    seen.add(file.path);
    if (Buffer.byteLength(file.contents, "utf8") > MAX_FILE_BYTES) {
      problems.push(`"${file.path}" is too large; split it into smaller files.`);
    }
  }

  for (const dep of app.dependencies) {
    if (!isAllowedDependency(dep)) problems.push(`Package "${dep}" is not in the allowed list.`);
  }
  return problems;
}
