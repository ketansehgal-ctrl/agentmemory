import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppFile } from "./schema.js";

export type ProjectStatus = "generating" | "ready" | "failed";
export type BuildPlatform = "android";
export type BuildStatus = "preparing" | "queued" | "in-progress" | "finished" | "errored" | "canceled";

export const FINAL_BUILD_STATUSES: ReadonlySet<BuildStatus> = new Set(["finished", "errored", "canceled"]);

export interface ChatEntry {
  from: "client" | "studio";
  text: string;
  at: string;
}

export interface PreviewInfo {
  snackId: string;
  url: string;
  embedUrl: string;
  savedAt: string;
}

export interface BuildRecord {
  id: string;
  easBuildId?: string;
  platform: BuildPlatform;
  status: BuildStatus;
  startedAt: string;
  updatedAt: string;
  downloadUrl?: string;
  error?: string;
}

export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  error?: string;
  appName: string;
  primaryColor: string;
  files: AppFile[];
  dependencies: string[];
  chat: ChatEntry[];
  preview?: PreviewInfo;
  previewError?: string;
  builds: BuildRecord[];
}

export interface ProjectStore {
  create(firstRequest: string): Promise<Project>;
  get(id: string): Promise<Project | undefined>;
  save(project: Project): Promise<void>;
}

const PROJECT_ID = /^[0-9a-f-]{36}$/;

export class FileProjectStore implements ProjectStore {
  constructor(private readonly dir: string) {}

  async create(firstRequest: string): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "generating",
      appName: "New app",
      primaryColor: "#1F6F4A",
      files: [],
      dependencies: [],
      chat: [{ from: "client", text: firstRequest, at: now }],
      builds: [],
    };
    await this.save(project);
    return project;
  }

  async get(id: string): Promise<Project | undefined> {
    if (!PROJECT_ID.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(this.fileFor(id), "utf8")) as Project;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(project: Project): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.fileFor(project.id);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(project, null, 2));
    await rename(temp, target);
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }
}
