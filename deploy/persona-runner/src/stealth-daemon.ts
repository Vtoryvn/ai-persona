import {
  buildAcceptLanguage,
  buildClientHints,
  type Fingerprint,
} from "@achamm/veilbrowser";
import { buildVeilFingerprintArgs } from "./fingerprint-profile.js";
import type { MissionRequest } from "@persona-system/shared";

const CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT ?? "9222";
const CHROME_DEBUG_URL =
  process.env.CHROME_DEBUG_URL ?? `http://127.0.0.1:${CHROME_DEBUG_PORT}`;

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

class LivePageGuard {
  private ws: WebSocket | null = null;

  constructor(private wsUrl: string) {}

  async connect(fp: Fingerprint): Promise<void> {
    const ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("CDP WS open failed")));
    });
    this.ws = ws;

    await this.send("Emulation.setUserAgentOverride", {
      userAgent: fp.userAgent,
      acceptLanguage: fp.languages.join(","),
      platform: fp.platform,
      userAgentMetadata: buildClientHints(fp),
    });

    await this.send("Emulation.setTimezoneOverride", { timezoneId: fp.timezone });
    try {
      await this.send("Emulation.setLocaleOverride", { locale: fp.locale });
    } catch {
      // locale override may already be active
    }
    if (fp.geolocation) {
      await this.send("Emulation.setGeolocationOverride", {
        latitude: fp.geolocation.latitude,
        longitude: fp.geolocation.longitude,
        accuracy: fp.geolocation.accuracy ?? 100,
      });
    }
    try {
      await this.send("Runtime.evaluate", {
        expression: "window.speechSynthesis && window.speechSynthesis.getVoices()",
      });
    } catch {
      // ignore speech warm-up errors
    }
  }

  private send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP socket not open"));
    }
    const id = Math.floor(Math.random() * 1_000_000);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 12_000);
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as { id?: number; result?: T; error?: { message?: string } };
        if (msg.id !== id) return;
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        if (msg.error) reject(new Error(msg.error.message ?? "CDP error"));
        else resolve(msg.result as T);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const guardedTargetIds = new Set<string>();
const liveGuards = new Map<string, LivePageGuard>();
let latestFingerprint: Fingerprint | null = null;
let pollTimer: NodeJS.Timeout | null = null;

async function listPageTargets(): Promise<CdpTarget[]> {
  const res = await fetch(`${CHROME_DEBUG_URL}/json/list`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return [];
  const all = (await res.json()) as CdpTarget[];
  return all.filter(
    (t) =>
      t.type === "page" &&
      t.webSocketDebuggerUrl &&
      !/^(devtools|chrome-extension):\/\//i.test(t.url ?? ""),
  );
}

async function guardNewTargets(): Promise<void> {
  if (!latestFingerprint) return;
  const targets = await listPageTargets();
  for (const t of targets) {
    if (guardedTargetIds.has(t.id) || !t.webSocketDebuggerUrl) continue;
    try {
      const guard = new LivePageGuard(t.webSocketDebuggerUrl);
      await guard.connect(latestFingerprint);
      guardedTargetIds.add(t.id);
      liveGuards.set(t.id, guard);
    } catch {
      // retry on next poll
    }
  }
}

/**
 * Keep native C++ CDP timezone/locale/geolocation synced across mission end and human noVNC tabs.
 */
export async function syncPersistentStealthForMission(mission: MissionRequest): Promise<void> {
  const built = await buildVeilFingerprintArgs(mission);
  if (!built) return;
  const fp = (built.args as { fingerprint?: Fingerprint }).fingerprint;
  if (!fp) return;

  latestFingerprint = fp;
  guardedTargetIds.clear();
  liveGuards.clear();

  await guardNewTargets();

  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void guardNewTargets();
    }, 2500);
    pollTimer.unref();
  }
}

export async function startBootStealthDaemon(): Promise<void> {
  const synthetic: MissionRequest = {
    persona_id: process.env.PERSONA_ID ?? "boot",
    prompt: "boot",
    instructions: "boot",
    browser: {
      viewport: process.env.MCP_VIEWPORT ?? "1280x720",
      fingerprintPreset: process.env.PERSONA_FINGERPRINT_PRESET ?? "linux-chrome",
      matchProxyGeo: true,
    },
  };
  try {
    await syncPersistentStealthForMission(synthetic);
  } catch {
    // Chrome or proxy may still be warming; mission start will re-sync
  }
}
