import { describe, expect, it } from "vitest";
import { resolveDependencies } from "../src/catalog.js";
import { findAppProblems, isSafeAppPath } from "../src/schema.js";
import { sampleApp } from "./helpers.js";

describe("isSafeAppPath", () => {
  it.each(["App.js", "src/theme.js", "src/screens/Home.js", "src/components/ui/Button-2.js"])("accepts %s", (p) => {
    expect(isSafeAppPath(p)).toBe(true);
  });

  it.each([
    "../App.js",
    "src/../../etc/passwd.js",
    "/App.js",
    "src/screens/Home.tsx",
    "package.json",
    "app.json",
    "src/.hidden.js",
    "src//Home.js",
    "index.js",
  ])("rejects %s", (p) => {
    expect(isSafeAppPath(p)).toBe(false);
  });
});

describe("findAppProblems", () => {
  it("accepts a well-formed app", () => {
    expect(findAppProblems(sampleApp())).toEqual([]);
  });

  it("reports a missing entry point, bad colour, unknown package and duplicate file", () => {
    const problems = findAppProblems(
      sampleApp({
        primaryColor: "green",
        dependencies: ["left-pad"],
        files: [
          { path: "src/Home.js", contents: "" },
          { path: "src/Home.js", contents: "" },
        ],
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "App.js is missing.",
        "primaryColor must be a 6-digit hex code like #1F6F4A.",
        'Package "left-pad" is not in the allowed list.',
        '"src/Home.js" appears twice.',
      ]),
    );
  });
});

describe("resolveDependencies", () => {
  it("adds the packages navigation needs", () => {
    expect(Object.keys(resolveDependencies(["@react-navigation/bottom-tabs"])).sort()).toEqual([
      "@react-navigation/bottom-tabs",
      "@react-navigation/native",
      "react-native-safe-area-context",
      "react-native-screens",
    ]);
  });

  it("ignores packages outside the catalogue", () => {
    expect(resolveDependencies(["left-pad"])).toEqual({});
  });
});
