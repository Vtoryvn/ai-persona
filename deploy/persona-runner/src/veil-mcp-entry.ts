import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  Browser,
  Page,
  buildAcceptLanguage,
  buildClientHints,
  type Fingerprint,
} from "@achamm/veilbrowser";

const require = createRequire(import.meta.url);

interface InternalPage {
  cdp: {
    send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
    on: (event: string, cb: (p: any) => void, sessionId?: string) => () => void;
  };
  sessionId: string;
  targetId: string;
  fingerprint?: Fingerprint;
  frameSessions: Array<{ sessionId: string; url: string; targetId: string }>;
  frameOff?: () => void;
  removeFrameSession: (match: (f: { sessionId: string; targetId: string }) => boolean) => void;
  trackDownloads: () => void;
  trackResponses: () => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  applyFingerprint: (fp: Fingerprint) => Promise<void>;
}

async function enableNativePageSession(page: InternalPage): Promise<void> {
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await page.send("Accessibility.enable");
  page.trackDownloads();
  page.trackResponses();
  await page.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const offAttach = page.cdp.on(
    "Target.attachedToTarget",
    (p: any) => {
      if (p.targetInfo?.type === "iframe") {
        page.frameSessions.push({
          sessionId: p.sessionId,
          url: p.targetInfo.url,
          targetId: p.targetInfo.targetId,
        });
      }
    },
    "*",
  );
  const offDetach = page.cdp.on(
    "Target.detachedFromTarget",
    (p: any) => {
      if (p.sessionId) page.removeFrameSession((f) => f.sessionId === p.sessionId);
    },
    "*",
  );
  const offDestroyed = page.cdp.on(
    "Target.targetDestroyed",
    (p: any) => {
      if (p.targetId) page.removeFrameSession((f) => f.targetId === p.targetId);
    },
    "*",
  );
  page.frameOff = () => {
    offAttach();
    offDetach();
    offDestroyed();
  };
}

// 1. Ensure attached pages have Page/DOM/Accessibility enabled WITHOUT injecting JS stealth scripts.
Browser.prototype.pages = async function (this: any): Promise<Page[]> {
  const { targetInfos } = await this.cdp.send("Target.getTargets");
  const wanted = (targetInfos || []).filter(
    (t: any) =>
      t.type === "page" && !/^(devtools|chrome-extension|chrome):\/\//i.test(t.url || ""),
  );
  const out: Page[] = [];
  for (const t of wanted) {
    const { sessionId } = await this.cdp.send("Target.attachToTarget", {
      targetId: t.targetId,
      flatten: true,
    });
    const page = new Page(this.cdp, sessionId, t.targetId) as unknown as InternalPage;
    await enableNativePageSession(page);
    out.push(page as unknown as Page);
  }
  return out;
};

// 2. Ensure newPage() also uses native C++ engine mode (zero Page.addScriptToEvaluateOnNewDocument).
Page.prototype.init = async function (this: InternalPage, opts: any = {}): Promise<void> {
  await enableNativePageSession(this);
  if (opts.fingerprint) {
    await this.applyFingerprint(opts.fingerprint);
  }
};

// 3. Apply fingerprint using ONLY C++ browser-level CDP commands (no JS prototype getters, no DeviceMetricsOverride).
Page.prototype.applyFingerprint = async function (
  this: InternalPage,
  fp: Fingerprint,
): Promise<void> {
  this.fingerprint = fp;

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
    // Locale override may already match or be set at launch via --lang
  }

  if (fp.geolocation) {
    await this.send("Emulation.setGeolocationOverride", {
      latitude: fp.geolocation.latitude,
      longitude: fp.geolocation.longitude,
      accuracy: fp.geolocation.accuracy ?? 100,
    });
  }
};

// 4. Resize the real X11 Chrome window instead of enabling DevTools Device Emulation.
Page.prototype.setViewport = async function (
  this: InternalPage,
  opts: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean },
): Promise<void> {
  try {
    const { windowId } = await this.cdp.send("Browser.getWindowForTarget", {
      targetId: this.targetId,
    });
    if (windowId != null) {
      const left = Math.max(0, Math.floor((1920 - opts.width) / 2));
      const top = Math.max(0, Math.floor((1040 - opts.height) / 2));
      await this.cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          left,
          top,
          width: opts.width,
          height: opts.height,
          windowState: "normal",
        },
      });
      return;
    }
  } catch {
    // Fallback if window bounds unsupported (e.g. headless mode)
  }
};

const mcpPath = require.resolve("@achamm/veilbrowser/dist/mcp.js");
await import(pathToFileURL(mcpPath).href);
