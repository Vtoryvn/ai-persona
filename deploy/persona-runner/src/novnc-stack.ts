import { spawn, type ChildProcess } from "node:child_process";

let started = false;
let x11vncProc: ChildProcess | null = null;
let novncProc: ChildProcess | null = null;

/** Start x11vnc + noVNC only when a human takes over (avoids scanbrowser RDP/VNC port detect). */
export function ensureNovncStack(): boolean {
  if (started) return true;
  if (process.env.PERSONA_NOVNC_LAZY === "0") return true;

  const display = process.env.DISPLAY ?? ":99";
  const novncPort = process.env.NOVNC_PORT ?? "6080";
  // Avoid standard VNC port 5900 — scanbrowser/iphey scan 5900 for VNC/RDP
  const rfbPort = process.env.X11VNC_RFB_PORT ?? "45911";

  x11vncProc = spawn(
    "x11vnc",
    ["-display", display, "-forever", "-shared", "-nopw", "-listen", "127.0.0.1", "-rfbport", rfbPort],
    { stdio: "ignore", detached: true },
  );
  x11vncProc.unref();

  novncProc = spawn(
    "/opt/noVNC/utils/novnc_proxy",
    ["--vnc", `127.0.0.1:${rfbPort}`, "--listen", novncPort],
    { stdio: "ignore", detached: true },
  );
  novncProc.unref();

  started = true;
  return true;
}

export function isNovncRunning(): boolean {
  if (process.env.PERSONA_NOVNC_LAZY === "0") return true;
  return started;
}
