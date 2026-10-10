import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASE_DEPENDENCIES, resolveDependencies } from "./catalog.js";
import type { Project } from "./projects.js";
import { isSafeAppPath } from "./schema.js";

export interface ExpoProjectOptions {
  appIdPrefix: string;
  owner?: string;
}

export const KEYSTORE_RELATIVE_PATH = "credentials/release.keystore";

function nameWords(project: Project): string {
  return project.appName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shortId(project: Project): string {
  return project.id.replace(/-/g, "").slice(0, 8);
}

/** URL-safe Expo slug, unique per project: "Darjeeling Tea" -> "darjeeling-tea-1a2b3c4d". */
export function appSlug(project: Project): string {
  const words = nameWords(project).replace(/ /g, "-").slice(0, 30).replace(/-+$/, "") || "app";
  return `${words}-${shortId(project)}`;
}

/** Valid as both an Android package and an iOS bundle ID: letters and digits only per segment. */
export function appIdentifier(prefix: string, project: Project): string {
  const words = nameWords(project).replace(/ /g, "").slice(0, 20);
  const segment = /^[a-z]/.test(words) ? words : `app${words}`;
  return `${prefix}.${segment}${shortId(project)}`;
}

async function existingEasProjectId(dir: string): Promise<string | undefined> {
  try {
    const appJson = JSON.parse(await readFile(path.join(dir, "app.json"), "utf8"));
    return appJson?.expo?.extra?.eas?.projectId;
  } catch {
    return undefined;
  }
}

export async function writeExpoProject(project: Project, dir: string, options: ExpoProjectOptions): Promise<void> {
  const root = path.resolve(dir);
  await mkdir(root, { recursive: true });
  const easProjectId = await existingEasProjectId(root);
  await rm(path.join(root, "src"), { recursive: true, force: true });
  await rm(path.join(root, "App.js"), { force: true });

  for (const file of project.files) {
    const target = path.resolve(root, file.path);
    if (!isSafeAppPath(file.path) || !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write unsafe path "${file.path}"`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents);
  }

  const slug = appSlug(project);
  const identifier = appIdentifier(options.appIdPrefix, project);
  const packageJson = {
    name: slug,
    version: "1.0.0",
    private: true,
    main: "index.js",
    dependencies: { ...BASE_DEPENDENCIES, ...resolveDependencies(project.dependencies) },
  };
  const appJson = {
    expo: {
      name: project.appName,
      slug,
      ...(options.owner ? { owner: options.owner } : {}),
      version: "1.0.0",
      orientation: "portrait",
      userInterfaceStyle: "light",
      primaryColor: project.primaryColor,
      splash: { backgroundColor: project.primaryColor, resizeMode: "contain" },
      android: { package: identifier, adaptiveIcon: { backgroundColor: project.primaryColor } },
      ios: { bundleIdentifier: identifier, supportsTablet: true },
      ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
    },
  };
  const easJson = {
    cli: { version: ">= 16.0.0", appVersionSource: "remote" },
    build: {
      preview: { distribution: "internal", credentialsSource: "local", android: { buildType: "apk" } },
      production: { credentialsSource: "local", autoIncrement: true },
    },
    submit: { production: {} },
  };
  const indexJs = `import { registerRootComponent } from "expo";\nimport App from "./App";\n\nregisterRootComponent(App);\n`;

  await Promise.all([
    writeFile(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n"),
    writeFile(path.join(root, "app.json"), JSON.stringify(appJson, null, 2) + "\n"),
    writeFile(path.join(root, "eas.json"), JSON.stringify(easJson, null, 2) + "\n"),
    writeFile(path.join(root, "index.js"), indexJs),
  ]);
}
