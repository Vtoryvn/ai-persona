import os from "node:os";
import { PRESETS, chromeFullVersion, type Fingerprint } from "@achamm/veilbrowser";
import type { MissionRequest } from "@persona-system/shared";
import { resolveProxyGeo, shouldMatchProxyGeo } from "./proxy-geo.js";

const PRESET_NAMES = new Set(Object.keys(PRESETS));
const CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT ?? "9222";
const CHROME_DEBUG_URL =
  process.env.CHROME_DEBUG_URL ?? `http://127.0.0.1:${CHROME_DEBUG_PORT}`;

async function readInstalledChromeVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${CHROME_DEBUG_URL}/json/version`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { Browser?: string; "User-Agent"?: string };
    const fromBrowser = data.Browser?.match(/Chrome\/([\d.]+)/)?.[1];
    if (fromBrowser) return fromBrowser;
    const ua = data["User-Agent"] ?? "";
    return chromeFullVersion(ua) !== "131.0.0.0" ? chromeFullVersion(ua) : null;
  } catch {
    return null;
  }
}

function patchWindowsUaVersion(windowsUa: string, fullVersion: string): string {
  return windowsUa.replace(/Chrome\/[\d.]+/, `Chrome/${fullVersion}`);
}

const OS_PROFILE_PRESETS: Record<string, string> = {
  windows: "windows-chrome",
  mac: "mac-chrome",
  linux: "linux-chrome",
};

const LOCALE_TIMEZONE: Record<string, string> = {
  "vi-VN": "Asia/Ho_Chi_Minh",
  "en-US": "America/New_York",
  "en-GB": "Europe/London",
};

const LOCALE_GEO: Record<string, Fingerprint["geolocation"]> = {
  "vi-VN": { latitude: 10.8231, longitude: 106.6297, accuracy: 60 },
  "en-US": { latitude: 40.7128, longitude: -74.006, accuracy: 60 },
};

function hostHardware(): { cores: number; memoryGb: number } {
  const cores = Number(process.env.PERSONA_HOST_CORES) || os.cpus().length || 2;
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const memoryGb =
    Number(process.env.PERSONA_DEVICE_MEMORY_GB) || Math.min(8, Math.max(2, ramGb));
  return {
    cores: Math.min(16, Math.max(2, cores)),
    memoryGb,
  };
}

function screenForViewport(width: number, height: number): Fingerprint["screen"] {
  const taskbar = 40;
  return {
    width,
    height,
    availWidth: width,
    availHeight: Math.max(height - taskbar, height - 80),
    colorDepth: 24,
  };
}

function localeToLanguages(locale: string): string[] {
  const base = locale.split("-")[0];
  return base && base !== locale ? [locale, base] : [locale];
}

export function resolveFingerprintPreset(mission: MissionRequest): string | null {
  const browser = mission.browser ?? {};
  const fromYaml = browser.fingerprintPreset?.trim();
  if (fromYaml) {
    if (/^(off|none|skip)$/i.test(fromYaml)) return null;
    return fromYaml;
  }
  if (browser.osProfile) {
    const mapped = OS_PROFILE_PRESETS[browser.osProfile];
    if (mapped) return mapped;
  }
  const fromEnv = process.env.PERSONA_FINGERPRINT_PRESET?.trim();
  if (fromEnv) {
    if (/^(off|none|skip)$/i.test(fromEnv)) return null;
    return fromEnv;
  }
  // Default to native Linux Chrome so OS kernel, fonts, WebGL, and C++ Navigator match 100%.
  return "linux-chrome";
}

export async function buildVeilFingerprintArgs(
  mission: MissionRequest,
): Promise<{ args: Record<string, unknown>; geoLabel?: string } | null> {
  const presetName = resolveFingerprintPreset(mission);
  if (!presetName) return null;

  const base = PRESETS[presetName];
  if (!base) {
    throw new Error(
      `Unknown fingerprint preset "${presetName}" (known: ${[...PRESET_NAMES].join(", ")})`,
    );
  }

  const browser = mission.browser ?? {};
  let locale = browser.locale?.trim() || base.locale;
  let timezone = browser.timezone?.trim() || LOCALE_TIMEZONE[locale] || base.timezone;
  let geolocation = LOCALE_GEO[locale] ?? base.geolocation;
  let geoLabel: string | undefined;

  if (shouldMatchProxyGeo(mission)) {
    const geo = await resolveProxyGeo(mission);
    if (geo) {
      locale = geo.locale;
      timezone = geo.timezone;
      geolocation = { latitude: geo.lat, longitude: geo.lon, accuracy: 60 };
      geoLabel = `${geo.countryCode} ${geo.timezone} (${geo.locale})`;
    }
  }

  const hw = hostHardware();
  const useSoftwareGl = process.env.PERSONA_WEBGL_SOFTWARE === "1";
  const displayW = Number(process.env.PERSONA_DISPLAY_WIDTH) || 1920;
  const displayH = Number(process.env.PERSONA_DISPLAY_HEIGHT) || 1080;

  let fingerprint: Fingerprint = {
    ...base,
    locale,
    timezone,
    languages: localeToLanguages(locale),
    geolocation,
    hardwareConcurrency: hw.cores,
    deviceMemory: hw.memoryGb,
    screen: screenForViewport(displayW, displayH),
    devicePixelRatio: 1,
  };

  if (useSoftwareGl) {
    fingerprint = {
      ...fingerprint,
      webglVendor: "Google Inc. (Google)",
      webglRenderer:
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    };
  }

  const installedVersion = await readInstalledChromeVersion();
  if (installedVersion) {
    fingerprint = {
      ...fingerprint,
      userAgent: patchWindowsUaVersion(fingerprint.userAgent, installedVersion),
    };
  }

  return { args: { fingerprint }, geoLabel };
}

export function parseViewport(
  mission: MissionRequest,
): { width: number; height: number } | null {
  const raw = mission.browser?.viewport?.trim() || process.env.MCP_VIEWPORT?.trim();
  if (!raw) return null;
  const match = /^(\d+)x(\d+)$/i.exec(raw);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}
