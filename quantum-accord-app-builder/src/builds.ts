import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { KEYSTORE_RELATIVE_PATH, writeExpoProject } from "./expoProject.js";
import type { BuildRecord, BuildStatus, Project } from "./projects.js";

export type RunCommand = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

export const runCommand: RunCommand = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    ...options,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

const DEFAULT_EAS_BIN = fileURLToPath(new URL("../node_modules/.bin/eas", import.meta.url));

export interface BuildService {
  /** Prepares the Expo project and queues an EAS build; returns the build with its EAS id. */
  start(project: Project, build: BuildRecord): Promise<BuildRecord>;
  /** Fetches the latest status (and download link) of a queued build. */
  refresh(project: Project, build: BuildRecord): Promise<BuildRecord>;
}

export interface EasBuildOptions {
  workDir: string;
  dataDir: string;
  expoToken: string;
  expoOwner?: string;
  appIdPrefix: string;
  easBin?: string;
}

interface SigningKey {
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}

interface EasBuild {
  id: string;
  status?: string;
  artifacts?: { buildUrl?: string; applicationArchiveUrl?: string };
  error?: { message?: string };
}

const EAS_STATUS: Record<string, BuildStatus> = {
  NEW: "queued",
  IN_QUEUE: "queued",
  IN_PROGRESS: "in-progress",
  PENDING_CANCEL: "in-progress",
  FINISHED: "finished",
  ERRORED: "errored",
  CANCELED: "canceled",
};

export function toBuildStatus(easStatus: string | undefined): BuildStatus {
  return EAS_STATUS[(easStatus ?? "").toUpperCase().replace(/-/g, "_")] ?? "queued";
}

/** eas-cli --json prints JSON on stdout (logs go to stderr); tolerate stray lines before it. */
export function parseEasJson(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error("EAS did not return JSON output");
  return JSON.parse(stdout.slice(start));
}

export function applyEasBuild(build: BuildRecord, eas: EasBuild): BuildRecord {
  return {
    ...build,
    easBuildId: eas.id,
    status: toBuildStatus(eas.status),
    updatedAt: new Date().toISOString(),
    downloadUrl: eas.artifacts?.buildUrl ?? eas.artifacts?.applicationArchiveUrl ?? build.downloadUrl,
    error: eas.error?.message ?? build.error,
  };
}

/**
 * Builds Android APKs on Expo's cloud (EAS Build). Each app gets its own upload
 * keystore, created once with keytool and kept under DATA_DIR/keystores: Google Play
 * only accepts updates signed with the same key, so it must never be regenerated.
 */
export class EasBuildService implements BuildService {
  private readonly easBin: string;

  constructor(
    private readonly options: EasBuildOptions,
    private readonly run: RunCommand = runCommand,
  ) {
    this.easBin = options.easBin ?? DEFAULT_EAS_BIN;
  }

  async start(project: Project, build: BuildRecord): Promise<BuildRecord> {
    const dir = this.projectDir(project);
    await writeExpoProject(project, dir, { appIdPrefix: this.options.appIdPrefix, owner: this.options.expoOwner });
    await this.installSigningKey(project, dir);

    const env = this.env();
    await this.run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, env });
    if (!(await this.hasEasProjectId(dir))) {
      await this.run(this.easBin, ["init", "--non-interactive", "--force"], { cwd: dir, env });
    }
    const { stdout } = await this.run(
      this.easBin,
      ["build", "--platform", "android", "--profile", "preview", "--non-interactive", "--no-wait", "--json"],
      { cwd: dir, env },
    );
    const output = parseEasJson(stdout);
    const easBuild = (Array.isArray(output) ? output[0] : output) as EasBuild | undefined;
    if (!easBuild?.id) throw new Error("EAS did not return a build id");
    return applyEasBuild(build, easBuild);
  }

  async refresh(project: Project, build: BuildRecord): Promise<BuildRecord> {
    if (!build.easBuildId) return build;
    const { stdout } = await this.run(this.easBin, ["build:view", build.easBuildId, "--json"], {
      cwd: this.projectDir(project),
      env: this.env(),
    });
    return applyEasBuild(build, parseEasJson(stdout) as EasBuild);
  }

  private projectDir(project: Project): string {
    return path.join(this.options.workDir, project.id);
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, EXPO_TOKEN: this.options.expoToken, EAS_NO_VCS: "1", CI: "1" };
  }

  private async hasEasProjectId(dir: string): Promise<boolean> {
    const appJson = JSON.parse(await readFile(path.join(dir, "app.json"), "utf8"));
    return Boolean(appJson?.expo?.extra?.eas?.projectId);
  }

  private async installSigningKey(project: Project, dir: string): Promise<void> {
    const keyDir = path.join(this.options.dataDir, "keystores");
    const keystore = path.join(keyDir, `${project.id}.keystore`);
    const secretsFile = path.join(keyDir, `${project.id}.json`);
    await mkdir(keyDir, { recursive: true, mode: 0o700 });

    let key: SigningKey;
    if (await exists(keystore)) {
      key = JSON.parse(await readFile(secretsFile, "utf8"));
    } else {
      key = { keystorePassword: secret(), keyAlias: "upload", keyPassword: secret() };
      const commonName = project.appName.replace(/[^A-Za-z0-9 ]/g, "").trim() || "App";
      await this.run(
        "keytool",
        [
          "-genkeypair", "-storetype", "JKS", "-keystore", keystore, "-alias", key.keyAlias,
          "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
          "-storepass:env", "QA_STORE_PASS", "-keypass:env", "QA_KEY_PASS",
          "-dname", `CN=${commonName}, O=Quantum Accord App Studio`,
        ],
        { cwd: keyDir, env: { ...process.env, QA_STORE_PASS: key.keystorePassword, QA_KEY_PASS: key.keyPassword } },
      );
      await writeFile(secretsFile, JSON.stringify(key, null, 2), { mode: 0o600 });
    }

    await mkdir(path.join(dir, path.dirname(KEYSTORE_RELATIVE_PATH)), { recursive: true });
    await copyFile(keystore, path.join(dir, KEYSTORE_RELATIVE_PATH));
    const credentials = { android: { keystore: { keystorePath: KEYSTORE_RELATIVE_PATH, ...key } } };
    await writeFile(path.join(dir, "credentials.json"), JSON.stringify(credentials, null, 2), { mode: 0o600 });
  }
}

function secret(): string {
  return randomBytes(18).toString("base64url");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
