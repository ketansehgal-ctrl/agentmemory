import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { BuildService } from "./builds.js";
import { GenerationError, type AppGenerator } from "./generator.js";
import type { PreviewService } from "./preview.js";
import { FINAL_BUILD_STATUSES, type BuildRecord, type Project, type ProjectStore } from "./projects.js";

export interface StudioDeps {
  store: ProjectStore;
  generator: AppGenerator;
  preview?: PreviewService;
  builds?: BuildService;
  accessKey?: string;
  publicDir?: string;
  log?: (message: string, error?: unknown) => void;
}

export const MIN_PROMPT_LENGTH = 10;
export const MAX_PROMPT_LENGTH = 4000;
const REFRESH_INTERVAL_MS = 10_000;

/** Serializes read-modify-write cycles per project so background jobs never overwrite each other. */
class ProjectLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(id, tail);
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return next;
  }
}

export function createStudioApp(deps: StudioDeps) {
  const { store, generator, preview, builds } = deps;
  const log = deps.log ?? ((message, error) => console.error(message, error ?? ""));
  const locks = new ProjectLocks();
  const jobs = new Set<Promise<void>>();
  /** Keys of background work alive in this process: "gen:<projectId>" or "build:<buildId>". */
  const running = new Set<string>();

  const startJob = (key: string, task: () => Promise<void>) => {
    running.add(key);
    const job: Promise<void> = task().finally(() => {
      running.delete(key);
      jobs.delete(job);
    });
    jobs.add(job);
  };

  const update = (id: string, change: (project: Project) => void) =>
    locks.run(id, async () => {
      const project = await store.get(id);
      if (!project) throw new Error(`Project ${id} disappeared`);
      change(project);
      project.updatedAt = new Date().toISOString();
      await store.save(project);
      return project;
    });

  async function generate(id: string, request: string): Promise<void> {
    try {
      const project = await store.get(id);
      if (!project) return;
      const hasApp = project.files.length > 0;
      const clientRequests = project.chat.filter((c) => c.from === "client").map((c) => c.text);
      const app = await generator.generate({
        request,
        current: hasApp
          ? { appName: project.appName, primaryColor: project.primaryColor, dependencies: project.dependencies, files: project.files }
          : undefined,
        earlierRequests: hasApp ? clientRequests.slice(0, -1) : [],
      });
      const updated = await update(id, (p) => {
        p.status = "ready";
        p.error = undefined;
        p.appName = app.appName;
        p.primaryColor = app.primaryColor;
        p.dependencies = app.dependencies;
        p.files = app.files;
        p.preview = undefined;
        p.previewError = undefined;
        p.chat.push({ from: "studio", text: app.summary, at: new Date().toISOString() });
      });
      if (preview) await publishPreview(updated);
    } catch (error) {
      log(`Generation failed for project ${id}`, error);
      const message =
        error instanceof GenerationError ? error.message : "Something went wrong while building your app. Please try again.";
      await update(id, (p) => {
        p.status = p.files.length > 0 ? "ready" : "failed";
        p.error = message;
        p.chat.push({ from: "studio", text: message, at: new Date().toISOString() });
      }).catch((e) => log(`Could not record failure for project ${id}`, e));
    }
  }

  async function publishPreview(project: Project): Promise<void> {
    try {
      const info = await preview!.publish(project);
      await update(project.id, (p) => {
        if (sameFiles(p, project)) p.preview = info;
      });
    } catch (error) {
      log(`Preview failed for project ${project.id}`, error);
      await update(project.id, (p) => {
        if (sameFiles(p, project)) {
          p.previewError = "The phone preview could not be created. Try requesting a small change to refresh it.";
        }
      });
    }
  }

  async function runBuild(project: Project, build: BuildRecord): Promise<void> {
    let result: BuildRecord;
    try {
      result = await builds!.start(project, build);
    } catch (error) {
      log(`Build failed to start for project ${project.id}`, error);
      result = { ...build, status: "errored", error: "The build could not be started.", updatedAt: new Date().toISOString() };
    }
    await update(project.id, (p) => replaceBuild(p, result)).catch((e) => log("Could not record build", e));
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  if (deps.publicDir) app.use(express.static(deps.publicDir));

  app.get("/api/config", (_req, res) => {
    res.json({ previewEnabled: Boolean(preview), buildsEnabled: Boolean(builds), accessKeyRequired: Boolean(deps.accessKey) });
  });

  app.use("/api/projects", (req, res, next) => {
    if (!deps.accessKey || keyMatches(req.get("x-studio-key"), deps.accessKey)) return next();
    res.status(401).json({ error: "A valid studio access key is required." });
  });

  app.post("/api/projects", async (req, res) => {
    const prompt = readPrompt(req, res);
    if (!prompt) return;
    const project = await store.create(prompt);
    startJob(`gen:${project.id}`, () => generate(project.id, prompt));
    res.status(202).json(project);
  });

  app.get("/api/projects/:id", async (req, res) => {
    let project = await store.get(req.params.id);
    if (!project) return void res.status(404).json({ error: "Project not found." });
    if (hasInterruptedWork(project)) project = await update(project.id, recoverInterruptedWork);
    res.json(project);
  });

  app.post("/api/projects/:id/changes", async (req, res) => {
    const prompt = readPrompt(req, res);
    if (!prompt) return;
    const id = req.params.id;
    const accepted = await locks.run(id, async () => {
      const project = await store.get(id);
      if (!project) return { status: 404, body: { error: "Project not found." } };
      if (project.status === "generating") {
        return { status: 409, body: { error: "Your app is still being built. Please wait for it to finish." } };
      }
      const now = new Date().toISOString();
      project.status = "generating";
      project.error = undefined;
      project.updatedAt = now;
      project.chat.push({ from: "client", text: prompt, at: now });
      running.add(`gen:${id}`);
      await store.save(project);
      return { status: 202, body: project };
    });
    if (accepted.status === 202) startJob(`gen:${id}`, () => generate(id, prompt));
    res.status(accepted.status).json(accepted.body);
  });

  app.post("/api/projects/:id/builds", async (req, res) => {
    if (!builds) {
      return void res.status(503).json({ error: "App builds are not switched on for this studio yet." });
    }
    if (req.body?.platform !== "android") {
      return void res.status(400).json({ error: 'Only "android" builds are available right now.' });
    }
    const id = req.params.id;
    const outcome = await locks.run(id, async (): Promise<
      { build: BuildRecord; project: Project } | { status: number; error: string }
    > => {
      const project = await store.get(id);
      if (!project) return { status: 404, error: "Project not found." };
      if (project.status !== "ready" || project.files.length === 0) {
        return { status: 409, error: "Wait until your app is ready before building it." };
      }
      if (project.builds.some((b) => !FINAL_BUILD_STATUSES.has(b.status))) {
        return { status: 409, error: "A build is already running for this app." };
      }
      const now = new Date().toISOString();
      const build: BuildRecord = { id: randomUUID(), platform: "android", status: "preparing", startedAt: now, updatedAt: now };
      project.builds.unshift(build);
      project.updatedAt = now;
      running.add(`build:${build.id}`);
      await store.save(project);
      return { build, project };
    });
    if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
    startJob(`build:${outcome.build.id}`, () => runBuild(outcome.project, outcome.build));
    res.status(202).json(outcome.build);
  });

  app.get("/api/projects/:id/builds/:buildId", async (req, res) => {
    const project = await store.get(req.params.id);
    const build = project?.builds.find((b) => b.id === req.params.buildId);
    if (!project || !build) return void res.status(404).json({ error: "Build not found." });

    const stale = Date.now() - Date.parse(build.updatedAt) > REFRESH_INTERVAL_MS;
    if (builds && build.easBuildId && !FINAL_BUILD_STATUSES.has(build.status) && stale) {
      try {
        const fresh = await builds.refresh(project, build);
        await update(project.id, (p) => replaceBuild(p, fresh));
        return void res.json(fresh);
      } catch (error) {
        log(`Could not refresh build ${build.id}`, error);
      }
    }
    res.json(build);
  });

  /** Work marked as in progress that no job in this process is doing, e.g. after a restart. */
  function hasInterruptedWork(project: Project): boolean {
    return (
      (project.status === "generating" && !running.has(`gen:${project.id}`)) ||
      project.builds.some((b) => b.status === "preparing" && !running.has(`build:${b.id}`))
    );
  }

  function recoverInterruptedWork(project: Project): void {
    const now = new Date().toISOString();
    if (project.status === "generating" && !running.has(`gen:${project.id}`)) {
      const message = "Building your app was interrupted. Please send your request again.";
      project.status = project.files.length > 0 ? "ready" : "failed";
      project.error = message;
      project.chat.push({ from: "studio", text: message, at: now });
    }
    for (const build of project.builds) {
      if (build.status === "preparing" && !running.has(`build:${build.id}`)) {
        build.status = "errored";
        build.error = "The build was interrupted. Please try again.";
        build.updatedAt = now;
      }
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log("Request failed", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return {
    app,
    /** Resolves once every background generation and build start has finished. */
    async idle(): Promise<void> {
      while (jobs.size > 0) await Promise.allSettled([...jobs]);
    },
  };
}

function readPrompt(req: Request, res: Response): string | undefined {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT_LENGTH || prompt.length > MAX_PROMPT_LENGTH) {
    res.status(400).json({
      error: `Describe your app in ${MIN_PROMPT_LENGTH} to ${MAX_PROMPT_LENGTH} characters.`,
    });
    return undefined;
  }
  return prompt;
}

function sameFiles(a: Project, b: Project): boolean {
  return JSON.stringify(a.files) === JSON.stringify(b.files);
}

function replaceBuild(project: Project, build: BuildRecord): void {
  const index = project.builds.findIndex((b) => b.id === build.id);
  if (index >= 0) project.builds[index] = build;
}

function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
