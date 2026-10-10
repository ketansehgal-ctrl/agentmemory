import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EasBuildService, parseEasJson, toBuildStatus, type RunCommand } from "../src/builds.js";
import type { BuildRecord } from "../src/projects.js";
import { sampleProject } from "./helpers.js";

const record: BuildRecord = {
  id: "local-1",
  platform: "android",
  status: "preparing",
  startedAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
};

function fakeRunner(easBuild: object) {
  const calls: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  const run: RunCommand = async (command, args, { cwd, env }) => {
    calls.push({ command, args, cwd, env });
    if (command === "keytool") {
      const keystore = args[args.indexOf("-keystore") + 1]!;
      await writeFile(keystore, "fake keystore");
    }
    if (args[0] === "init") {
      const appJsonPath = path.join(cwd, "app.json");
      const appJson = JSON.parse(await readFile(appJsonPath, "utf8"));
      appJson.expo.extra = { eas: { projectId: "eas-project-1" } };
      await writeFile(appJsonPath, JSON.stringify(appJson));
    }
    if (args[0] === "build") return { stdout: `Some log line\n${JSON.stringify([easBuild])}`, stderr: "" };
    if (args[0] === "build:view") return { stdout: JSON.stringify(easBuild), stderr: "" };
    return { stdout: "", stderr: "" };
  };
  return { run, calls };
}

async function service(easBuild: object) {
  const root = await mkdtemp(path.join(tmpdir(), "qa-builds-"));
  const runner = fakeRunner(easBuild);
  const builds = new EasBuildService(
    {
      workDir: path.join(root, "work"),
      dataDir: path.join(root, "data"),
      expoToken: "expo-token",
      appIdPrefix: "com.quantumaccord.apps",
      easBin: "eas",
    },
    runner.run,
  );
  return { builds, root, ...runner };
}

describe("EasBuildService", () => {
  it("prepares the project, signs it with a kept key and queues an Android build", async () => {
    const { builds, calls, root } = await service({ id: "eas-build-1", status: "IN_QUEUE" });
    const project = sampleProject();
    const result = await builds.start(project, record);

    expect(result).toMatchObject({ easBuildId: "eas-build-1", status: "queued" });
    expect(calls.map((c) => [c.command, c.args[0]])).toEqual([
      ["keytool", "-genkeypair"],
      ["npm", "install"],
      ["eas", "init"],
      ["eas", "build"],
    ]);
    const buildCall = calls[3]!;
    expect(buildCall.args).toEqual(
      expect.arrayContaining(["--platform", "android", "--profile", "preview", "--non-interactive", "--no-wait", "--json"]),
    );
    expect(buildCall.env).toMatchObject({ EXPO_TOKEN: "expo-token", EAS_NO_VCS: "1" });

    const keytool = calls[0]!;
    expect(keytool.args).not.toContain(keytool.env.QA_STORE_PASS);
    const credentials = JSON.parse(await readFile(path.join(root, "work", project.id, "credentials.json"), "utf8"));
    expect(credentials.android.keystore).toMatchObject({
      keystorePath: "credentials/release.keystore",
      keystorePassword: keytool.env.QA_STORE_PASS,
      keyAlias: "upload",
    });
  });

  it("reuses the signing key and EAS project on the next build", async () => {
    const { builds, calls } = await service({ id: "eas-build-2", status: "NEW" });
    const project = sampleProject();
    await builds.start(project, record);
    calls.length = 0;
    await builds.start(project, record);
    expect(calls.map((c) => [c.command, c.args[0]])).toEqual([
      ["npm", "install"],
      ["eas", "build"],
    ]);
  });

  it("refreshes a build and exposes its download link", async () => {
    const { builds } = await service({
      id: "eas-build-1",
      status: "FINISHED",
      artifacts: { buildUrl: "https://expo.dev/artifacts/eas/app.apk" },
    });
    const fresh = await builds.refresh(sampleProject(), { ...record, easBuildId: "eas-build-1", status: "in-progress" });
    expect(fresh).toMatchObject({ status: "finished", downloadUrl: "https://expo.dev/artifacts/eas/app.apk" });
  });
});

describe("EAS output helpers", () => {
  it.each([
    ["NEW", "queued"],
    ["in-queue", "queued"],
    ["IN_PROGRESS", "in-progress"],
    ["FINISHED", "finished"],
    ["ERRORED", "errored"],
    ["CANCELED", "canceled"],
    [undefined, "queued"],
  ])("maps %s to %s", (eas, ours) => {
    expect(toBuildStatus(eas)).toBe(ours);
  });

  it("finds JSON after log lines", () => {
    expect(parseEasJson('Uploading...\n[{"id":"x"}]')).toEqual([{ id: "x" }]);
    expect(() => parseEasJson("no json here")).toThrow();
  });
});
