import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appIdentifier, appSlug, writeExpoProject } from "../src/expoProject.js";
import { sampleProject } from "./helpers.js";

const options = { appIdPrefix: "com.quantumaccord.apps" };

describe("app identifiers", () => {
  it("builds a readable, unique slug", () => {
    expect(appSlug(sampleProject({ appName: "Darjeeling Tea!" }))).toBe("darjeeling-tea-3f2a9c1e");
    expect(appSlug(sampleProject({ appName: "!!!" }))).toBe("app-3f2a9c1e");
  });

  it("builds an id valid for both Android and iOS", () => {
    const id = appIdentifier("com.quantumaccord.apps", sampleProject({ appName: "9 to 5 Salon" }));
    expect(id).toBe("com.quantumaccord.apps.app9to5salon3f2a9c1e");
    expect(id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
  });
});

describe("writeExpoProject", () => {
  it("writes the app files and Expo config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-expo-"));
    await writeExpoProject(sampleProject(), dir, { ...options, owner: "quantumaccord" });

    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    expect(pkg.main).toBe("index.js");
    expect(pkg.dependencies).toMatchObject({
      expo: "~54.0.37",
      "@react-navigation/native-stack": expect.any(String),
      "@react-navigation/native": expect.any(String),
      "react-native-screens": "~4.16.0",
    });

    const app = JSON.parse(await readFile(path.join(dir, "app.json"), "utf8")).expo;
    expect(app.owner).toBe("quantumaccord");
    expect(app.android.package).toBe(app.ios.bundleIdentifier);

    const eas = JSON.parse(await readFile(path.join(dir, "eas.json"), "utf8"));
    expect(eas.build.preview).toMatchObject({ credentialsSource: "local", android: { buildType: "apk" } });

    expect(await readFile(path.join(dir, "src/screens/Home.js"), "utf8")).toContain("Home");
    expect(await readFile(path.join(dir, "index.js"), "utf8")).toContain("registerRootComponent(App)");
  });

  it("keeps installed packages and signing secrets out of the EAS upload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-expo-"));
    await writeExpoProject(sampleProject(), dir, options);
    const ignored = (await readFile(path.join(dir, ".easignore"), "utf8")).split("\n");
    expect(ignored).toEqual(expect.arrayContaining(["node_modules/", "credentials/", "credentials.json"]));
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe(ignored.join("\n"));
  });

  it("keeps the EAS project id and removes files the app no longer has", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-expo-"));
    await writeExpoProject(sampleProject(), dir, options);
    const appJsonPath = path.join(dir, "app.json");
    const appJson = JSON.parse(await readFile(appJsonPath, "utf8"));
    appJson.expo.extra = { eas: { projectId: "eas-123" } };
    await writeFile(appJsonPath, JSON.stringify(appJson));

    await writeExpoProject(sampleProject({ files: [{ path: "App.js", contents: "x" }] }), dir, options);

    expect(JSON.parse(await readFile(appJsonPath, "utf8")).expo.extra.eas.projectId).toBe("eas-123");
    await expect(access(path.join(dir, "src/screens/Home.js"))).rejects.toThrow();
  });

  it("refuses paths that escape the project folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-expo-"));
    const project = sampleProject({ files: [{ path: "../outside.js", contents: "x" }] });
    await expect(writeExpoProject(project, dir, options)).rejects.toThrow(/unsafe path/);
  });
});
