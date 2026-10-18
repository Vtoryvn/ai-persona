import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const profileDir = process.env.CHROME_USER_DATA_DIR ?? "/data/chrome-profile";
const defaultDir = path.join(profileDir, "Default");
const prefsPath = path.join(defaultDir, "Preferences");

mkdirSync(defaultDir, { recursive: true });

let prefs = {};
try {
  prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
} catch {
  prefs = {};
}

prefs.webrtc = {
  ...(prefs.webrtc ?? {}),
  ip_handling_policy: "default_public_interface_only",
  multiple_routes_enabled: false,
  nonproxied_udp_enabled: true,
};

writeFileSync(prefsPath, JSON.stringify(prefs));
process.stdout.write(`patched ${prefsPath}\n`);
