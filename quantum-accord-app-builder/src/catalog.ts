/**
 * Expo SDK the studio targets for both the phone preview (Expo Snack) and
 * cloud builds (EAS). Snack only runs SDKs listed by snack-sdk's
 * getSupportedSDKVersions(), so bump these together when Snack adds a newer SDK.
 * Versions come from expo@54's bundledNativeModules.json.
 */
export const EXPO_SDK_VERSION = "54.0.0";

export const BASE_DEPENDENCIES: Record<string, string> = {
  expo: "~54.0.37",
  react: "19.1.0",
  "react-native": "0.81.5",
  "expo-status-bar": "~3.0.9",
};

export interface CatalogEntry {
  version: string;
  use: string;
  requires?: string[];
}

export const OPTIONAL_DEPENDENCIES: Record<string, CatalogEntry> = {
  "@expo/vector-icons": { version: "^15.0.3", use: "icons (Ionicons, MaterialIcons, FontAwesome, ...)" },
  "expo-linear-gradient": { version: "~15.0.8", use: "gradient backgrounds" },
  "expo-image": { version: "~3.0.11", use: "fast remote images" },
  "expo-haptics": { version: "~15.0.8", use: "vibration feedback on taps" },
  "expo-web-browser": { version: "~15.0.11", use: "open a web page in an in-app browser" },
  "expo-clipboard": { version: "~8.0.8", use: "copy text" },
  "expo-sharing": { version: "~14.0.8", use: "share files" },
  "expo-image-picker": { version: "~17.0.11", use: "pick or take photos" },
  "expo-location": { version: "~19.0.8", use: "current location" },
  "@react-native-async-storage/async-storage": { version: "2.2.0", use: "save data on the device" },
  "react-native-safe-area-context": { version: "~5.6.0", use: "keep content clear of notches and home bars" },
  "react-native-screens": { version: "~4.16.0", use: "native screen containers (used by navigation)" },
  "react-native-svg": { version: "15.12.1", use: "vector shapes and simple charts" },
  "@react-navigation/native": {
    version: "^7.1.0",
    use: "navigation container",
    requires: ["react-native-screens", "react-native-safe-area-context"],
  },
  "@react-navigation/native-stack": {
    version: "^7.3.0",
    use: "stack navigation between screens",
    requires: ["@react-navigation/native"],
  },
  "@react-navigation/bottom-tabs": {
    version: "^7.3.0",
    use: "bottom tab bar",
    requires: ["@react-navigation/native"],
  },
};

export function isAllowedDependency(name: string): boolean {
  return Object.hasOwn(OPTIONAL_DEPENDENCIES, name);
}

/** The chosen packages plus everything they need, as name -> version. */
export function resolveDependencies(chosen: string[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  const visit = (name: string) => {
    if (resolved[name]) return;
    const entry = OPTIONAL_DEPENDENCIES[name];
    if (!entry) return;
    resolved[name] = entry.version;
    entry.requires?.forEach(visit);
  };
  chosen.forEach(visit);
  return resolved;
}

export function describeCatalog(): string {
  return Object.entries(OPTIONAL_DEPENDENCIES)
    .map(([name, entry]) => `- ${name}: ${entry.use}`)
    .join("\n");
}
