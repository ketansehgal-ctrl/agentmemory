import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { BuildService } from "../src/builds.js";
import { GenerationError, type AppGenerator } from "../src/generator.js";
import type { PreviewService } from "../src/preview.js";
import { FileProjectStore, type BuildRecord } from "../src/projects.js";
import { createStudioApp, type StudioDeps } from "../src/server.js";
import { sampleApp } from "./helpers.js";

const PROMPT = "A catalogue app for my Darjeeling tea business";

async function studio(overrides: Partial<StudioDeps> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-studio-"));
  const generator: AppGenerator = { generate: vi.fn(async () => sampleApp()) };
  const preview: PreviewService = {
    publish: vi.fn(async () => ({
      snackId: "abc",
      url: "https://snack.expo.dev/abc",
      embedUrl: "https://snack.expo.dev/embedded/abc",
      savedAt: "2026-10-10T00:00:00.000Z",
    })),
  };
  const store = new FileProjectStore(dir);
  const instance = createStudioApp({ store, generator, preview, log: () => {}, ...overrides });
  return { ...instance, store, generator, preview };
}

async function createReadyProject(s: Awaited<ReturnType<typeof studio>>) {
  const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
  await s.idle();
  return created.body.id as string;
}

describe("studio API", () => {
  it("builds an app in the background and publishes a preview", async () => {
    const s = await studio();
    const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
    expect(created.body.status).toBe("generating");

    await s.idle();
    const { body } = await request(s.app).get(`/api/projects/${created.body.id}`).expect(200);
    expect(body).toMatchObject({ status: "ready", appName: "Darjeeling Tea", preview: { url: "https://snack.expo.dev/abc" } });
    expect(body.chat.map((c: { from: string }) => c.from)).toEqual(["client", "studio"]);
  });

  it("rejects prompts that are too short or too long", async () => {
    const s = await studio();
    await request(s.app).post("/api/projects").send({ prompt: "app" }).expect(400);
    await request(s.app).post("/api/projects").send({ prompt: "x".repeat(4001) }).expect(400);
    await request(s.app).post("/api/projects").send({}).expect(400);
  });

  it("applies a change request with the current app and earlier requests", async () => {
    const s = await studio();
    const id = await createReadyProject(s);
    await request(s.app).post(`/api/projects/${id}/changes`).send({ prompt: "Make the buttons gold please" }).expect(202);
    await s.idle();

    expect(s.generator.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: "Make the buttons gold please",
        current: expect.objectContaining({ appName: "Darjeeling Tea" }),
        earlierRequests: [PROMPT],
      }),
    );
  });

  it("refuses a change while the app is still being generated", async () => {
    let finish!: () => void;
    const generator: AppGenerator = {
      generate: () => new Promise((resolve) => (finish = () => resolve(sampleApp()))),
    };
    const s = await studio({ generator });
    const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
    await request(s.app).post(`/api/projects/${created.body.id}/changes`).send({ prompt: "Add a gold theme" }).expect(409);
    finish();
    await s.idle();
  });

  it("keeps the working app when a change fails", async () => {
    const s = await studio();
    const id = await createReadyProject(s);
    vi.mocked(s.generator.generate).mockRejectedValueOnce(new GenerationError("Try fewer screens."));
    await request(s.app).post(`/api/projects/${id}/changes`).send({ prompt: "Add fifty more screens" }).expect(202);
    await s.idle();

    const { body } = await request(s.app).get(`/api/projects/${id}`).expect(200);
    expect(body).toMatchObject({ status: "ready", error: "Try fewer screens." });
    expect(body.files.length).toBeGreaterThan(0);
  });

  it("marks a first build failure as failed with a friendly message", async () => {
    const s = await studio({ generator: { generate: async () => Promise.reject(new Error("boom")) } });
    const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
    await s.idle();
    const { body } = await request(s.app).get(`/api/projects/${created.body.id}`).expect(200);
    expect(body.status).toBe("failed");
    expect(body.error).not.toContain("boom");
  });

  it("requires the access key when one is configured", async () => {
    const s = await studio({ accessKey: "secret-key" });
    await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(401);
    await request(s.app).post("/api/projects").set("x-studio-key", "wrong-key!").send({ prompt: PROMPT }).expect(401);
    await request(s.app).post("/api/projects").set("x-studio-key", "secret-key").send({ prompt: PROMPT }).expect(202);
    const config = await request(s.app).get("/api/config").expect(200);
    expect(config.body).toMatchObject({ accessKeyRequired: true, buildsEnabled: false });
    await s.idle();
  });

  it("returns 503 for builds when they are not configured", async () => {
    const s = await studio();
    const id = await createReadyProject(s);
    await request(s.app).post(`/api/projects/${id}/builds`).send({ platform: "android" }).expect(503);
  });

  it("starts one Android build at a time and refreshes its status", async () => {
    const builds: BuildService = {
      start: vi.fn(async (_p, b: BuildRecord) => ({ ...b, easBuildId: "eas-1", status: "queued" as const })),
      refresh: vi.fn(async (_p, b: BuildRecord) => ({
        ...b,
        status: "finished" as const,
        downloadUrl: "https://expo.dev/artifacts/app.apk",
        updatedAt: new Date().toISOString(),
      })),
    };
    const s = await studio({ builds });
    const id = await createReadyProject(s);

    await request(s.app).post(`/api/projects/${id}/builds`).send({ platform: "ios" }).expect(400);
    const started = await request(s.app).post(`/api/projects/${id}/builds`).send({ platform: "android" }).expect(202);
    await request(s.app).post(`/api/projects/${id}/builds`).send({ platform: "android" }).expect(409);
    await s.idle();

    const project = await s.store.get(id);
    project!.builds[0]!.updatedAt = "2026-01-01T00:00:00.000Z";
    await s.store.save(project!);

    const { body } = await request(s.app).get(`/api/projects/${id}/builds/${started.body.id}`).expect(200);
    expect(body).toMatchObject({ status: "finished", downloadUrl: "https://expo.dev/artifacts/app.apk" });
    expect(builds.refresh).toHaveBeenCalledOnce();
  });

  it("unblocks work that was interrupted, such as by a server restart", async () => {
    const s = await studio();
    const project = await s.store.create(PROMPT);
    project.builds.push({
      id: "build-1",
      platform: "android",
      status: "preparing",
      startedAt: project.createdAt,
      updatedAt: project.createdAt,
    });
    await s.store.save(project);

    const { body } = await request(s.app).get(`/api/projects/${project.id}`).expect(200);
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/interrupted/);
    expect(body.builds[0]).toMatchObject({ status: "errored", error: expect.stringMatching(/interrupted/) });
  });

  it("does not report a generation in progress as interrupted", async () => {
    let finish!: () => void;
    const s = await studio({ generator: { generate: () => new Promise((r) => (finish = () => r(sampleApp()))) } });
    const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
    const { body } = await request(s.app).get(`/api/projects/${created.body.id}`).expect(200);
    expect(body.status).toBe("generating");
    finish();
    await s.idle();
  });

  it("never lets an older preview replace a newer one", async () => {
    let releaseFirst!: () => void;
    const preview: PreviewService = {
      publish: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirst = () =>
                resolve({ snackId: "old", url: "https://snack.expo.dev/old", embedUrl: "e", savedAt: "t" });
            }),
        )
        .mockResolvedValueOnce({ snackId: "new", url: "https://snack.expo.dev/new", embedUrl: "e", savedAt: "t" }),
    };
    const generator: AppGenerator = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(sampleApp())
        .mockResolvedValueOnce(sampleApp({ files: [{ path: "App.js", contents: "// v2" }] })),
    };
    const s = await studio({ preview, generator });
    const created = await request(s.app).post("/api/projects").send({ prompt: PROMPT }).expect(202);
    await vi.waitFor(() => expect(preview.publish).toHaveBeenCalledTimes(1));
    await request(s.app).post(`/api/projects/${created.body.id}/changes`).send({ prompt: "Make it gold please" }).expect(202);
    await vi.waitFor(() => expect(preview.publish).toHaveBeenCalledTimes(2));
    releaseFirst();
    await s.idle();

    const { body } = await request(s.app).get(`/api/projects/${created.body.id}`).expect(200);
    expect(body.preview.snackId).toBe("new");
  });

  it("returns 404 for unknown or malformed project ids", async () => {
    const s = await studio();
    await request(s.app).get("/api/projects/does-not-exist").expect(404);
    await request(s.app).get("/api/projects/00000000-0000-0000-0000-000000000000").expect(404);
  });
});
