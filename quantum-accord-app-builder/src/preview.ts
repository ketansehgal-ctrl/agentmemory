import { Snack, type SDKVersion, type SnackDependencies, type SnackFiles } from "snack-sdk";
import { BASE_DEPENDENCIES, EXPO_SDK_VERSION, resolveDependencies } from "./catalog.js";
import type { PreviewInfo, Project } from "./projects.js";

export interface PreviewService {
  publish(project: Project): Promise<PreviewInfo>;
}

export function toSnackFiles(project: Project): SnackFiles {
  return Object.fromEntries(
    project.files.map((file) => [file.path, { type: "CODE" as const, contents: file.contents }]),
  );
}

export function toSnackDependencies(project: Project): SnackDependencies {
  const versions = {
    "expo-status-bar": BASE_DEPENDENCIES["expo-status-bar"],
    ...resolveDependencies(project.dependencies),
  };
  return Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, { version }]));
}

/** https://snack.expo.dev/abc -> https://snack.expo.dev/embedded/abc?... (the app running in Snack's web player). */
export function embedUrlFor(snackUrl: string): string {
  const url = new URL(snackUrl);
  url.pathname = `/embedded${url.pathname}`;
  url.search = new URLSearchParams({ preview: "true", platform: "web", theme: "light", hideQueryParams: "true" }).toString();
  return url.toString();
}

/** Saves the app as an Expo Snack: a page with a web preview and a QR code for the Expo Go app. */
export class SnackPreviewService implements PreviewService {
  async publish(project: Project): Promise<PreviewInfo> {
    const snack = new Snack({
      name: project.appName,
      description: `Built with Quantum Accord App Studio`,
      sdkVersion: EXPO_SDK_VERSION as SDKVersion,
      files: toSnackFiles(project),
      dependencies: toSnackDependencies(project),
    });
    const saved = await snack.saveAsync();
    return {
      snackId: saved.id,
      url: saved.url,
      embedUrl: embedUrlFor(saved.url),
      savedAt: new Date().toISOString(),
    };
  }
}
