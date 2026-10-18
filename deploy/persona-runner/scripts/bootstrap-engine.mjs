import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ProxyChain from "proxy-chain";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const COUNTRY_LOCALE = {
  US: "en-US",
  GB: "en-GB",
  AU: "en-AU",
  CA: "en-CA",
  DE: "de-DE",
  FR: "fr-FR",
  ES: "es-ES",
  IT: "it-IT",
  NL: "nl-NL",
  PL: "pl-PL",
  VN: "vi-VN",
  JP: "ja-JP",
  KR: "ko-KR",
  SG: "en-SG",
  IN: "en-IN",
  BR: "pt-BR",
  MX: "es-MX",
  TH: "th-TH",
  ID: "id-ID",
  PH: "en-PH",
  MY: "en-MY",
  HK: "zh-HK",
  TW: "zh-TW",
  CN: "zh-CN",
  CH: "de-CH",
  AT: "de-AT",
  BE: "nl-BE",
  SE: "sv-SE",
  NO: "nb-NO",
  DK: "da-DK",
  FI: "fi-FI",
};

const cores = Math.max(2, Math.min(32, Number(process.env.PERSONA_HOST_CORES || 8)));
const ramGb = Math.max(2, Math.min(64, Number(process.env.PERSONA_DEVICE_MEMORY_GB || 8)));
const totalKb = ramGb * 1024 * 1024;
const freeKb = Math.floor(totalKb * 0.55);
const availKb = Math.floor(totalKb * 0.72);

writeFileSync(
  "/tmp/persona_meminfo",
  [
    `MemTotal:       ${totalKb} kB`,
    `MemFree:        ${freeKb} kB`,
    `MemAvailable:   ${availKb} kB`,
    `Buffers:          262144 kB`,
    `Cached:          1048576 kB`,
    `SwapTotal:       2097152 kB`,
    `SwapFree:        2097152 kB`,
    "",
  ].join("\n"),
);

writeFileSync("/tmp/persona_cpu_online", `0-${cores - 1}\n`);
writeFileSync("/tmp/persona_cores", `${cores}\n`);
writeFileSync("/tmp/persona_ram_gb", `${ramGb}\n`);

try {
  const rawCpu = readFileSync("/proc/cpuinfo", "utf8");
  const firstBlock = (rawCpu.split(/\n\s*\n/)[0] || "")
    .replace(/^processor\s*:.*$/m, "processor\t: __IDX__")
    .replace(/^cpu cores\s*:.*$/m, `cpu cores\t: ${Math.max(1, Math.floor(cores / 2))}`)
    .replace(/^siblings\s*:.*$/m, `siblings\t: ${cores}`);
  if (firstBlock) {
    const blocks = Array.from({ length: cores }, (_, i) =>
      firstBlock.replace("__IDX__", String(i)),
    ).join("\n\n");
    writeFileSync("/tmp/persona_cpuinfo", `${blocks}\n\n`);
  }
} catch {
  // fallback if /proc/cpuinfo unreadable
}

let timezone = process.env.PERSONA_DEFAULT_TIMEZONE || "Asia/Ho_Chi_Minh";
let locale = process.env.PERSONA_DEFAULT_LOCALE || "vi-VN";
let lat = 10.8231;
let lon = 106.6297;
let exitIp = "";

const localProxy = process.env.PERSONA_LOCAL_PROXY_URL?.trim() || "";
const upstreamProxy = process.env.BROWSER_PROXY_URL?.trim() || "";
const proxyForGeo = localProxy || upstreamProxy;

async function resolveGeo(proxyUrl) {
  let targetProxy = proxyUrl;
  let ownsAnon = false;
  if (/^https?:\/\//i.test(proxyUrl) && proxyUrl.includes("@")) {
    targetProxy = await ProxyChain.anonymizeProxy(proxyUrl);
    ownsAnon = true;
  }
  const dispatcher = new ProxyAgent(targetProxy);
  try {
    const endpoints = [
      "http://ip-api.com/json/?fields=status,query,timezone,countryCode,lat,lon",
      "https://ipapi.co/json/",
    ];
    for (const url of endpoints) {
      try {
        const res = await undiciFetch(url, {
          dispatcher,
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (url.includes("ip-api.com")) {
          if (data.status !== "success") continue;
          const cc = String(data.countryCode || "US").toUpperCase();
          return {
            ip: String(data.query || "").trim(),
            timezone: String(data.timezone || "UTC"),
            locale: COUNTRY_LOCALE[cc] || `en-${cc}`,
            lat: Number(data.lat) || 0,
            lon: Number(data.lon) || 0,
          };
        }
        const cc = String(data.country_code || data.country || "US")
          .slice(0, 2)
          .toUpperCase();
        return {
          ip: String(data.ip || "").trim(),
          timezone: String(data.timezone || "UTC"),
          locale: COUNTRY_LOCALE[cc] || `en-${cc}`,
          lat: Number(data.latitude) || 0,
          lon: Number(data.longitude) || 0,
        };
      } catch {
        // try next
      }
    }
  } finally {
    await dispatcher.close?.();
    if (ownsAnon) await ProxyChain.closeAnonymizedProxy(targetProxy, true);
  }
  return null;
}

if (proxyForGeo) {
  const geo = await resolveGeo(proxyForGeo);
  if (geo) {
    exitIp = geo.ip || "";
    timezone = geo.timezone;
    locale = geo.locale;
    lat = geo.lat;
    lon = geo.lon;
  }
}

if (exitIp) {
  writeFileSync("/tmp/persona_exit_ip", `${exitIp}\n`);
}
writeFileSync("/tmp/persona_block_udp", proxyForGeo ? "1\n" : "0\n");

const baseLang = locale.split("-")[0] || "en";
const forcedLanguages =
  baseLang !== locale
    ? [locale, baseLang, "en-US", "en"]
    : [locale, "en-US", "en"];

const profileDir = process.env.CHROME_USER_DATA_DIR || "/data/chrome-profile";
for (const sub of ["Default", "Profile 1"]) {
  const dir = `${profileDir}/${sub}`;
  const prefPath = `${dir}/Preferences`;
  try {
    mkdirSync(dir, { recursive: true });
    let prefs = {};
    try {
      prefs = JSON.parse(readFileSync(prefPath, "utf8"));
    } catch {
      prefs = {};
    }
    prefs.intl = {
      ...(prefs.intl || {}),
      accept_languages: forcedLanguages.join(","),
      selected_languages: forcedLanguages.join(","),
    };
    prefs.webrtc = {
      ...(prefs.webrtc || {}),
      ip_handling_policy: "default_public_interface_only",
      multiple_routes_enabled: false,
      nonproxied_udp_enabled: true,
    };
    writeFileSync(prefPath, JSON.stringify(prefs));
  } catch {
    // ignore pref write errors
  }
}

for (const dir of [
  "/etc/opt/chrome/policies/managed",
  "/etc/chromium/policies/managed",
]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/persona_policy.json`,
    JSON.stringify(
      {
        CommandLineFlagSecurityWarningsEnabled: false,
        WebRtcIpHandling: "default_public_interface_only",
        TranslateEnabled: false,
        PasswordManagerEnabled: false,
        AutofillAddressEnabled: false,
        AutofillCreditCardEnabled: false,
        MetricsReportingEnabled: false,
        PromotionalTabsEnabled: false,
        DefaultNotificationsSetting: 2,
        ForcedLanguages: forcedLanguages,
      },
      null,
      2,
    ),
  );
}

let proxyPort = "";
if (localProxy) {
  try {
    proxyPort = new URL(localProxy).port;
  } catch {
    proxyPort = "";
  }
}
writeFileSync("/tmp/persona_proxy_port", `${proxyPort}\n`);

writeFileSync(
  "/tmp/persona-engine-env.sh",
  [
    `export TZ=${JSON.stringify(timezone)}`,
    `export PERSONA_EXIT_IP=${JSON.stringify(exitIp)}`,
    `export PERSONA_RESOLVED_TZ=${JSON.stringify(timezone)}`,
    `export PERSONA_RESOLVED_LOCALE=${JSON.stringify(locale)}`,
    `export PERSONA_RESOLVED_LAT=${JSON.stringify(String(lat))}`,
    `export PERSONA_RESOLVED_LON=${JSON.stringify(String(lon))}`,
    `export PERSONA_LOCAL_PROXY_PORT=${JSON.stringify(proxyPort)}`,
    `export PERSONA_BLOCK_NON_LOCAL_UDP=${JSON.stringify(proxyForGeo ? "1" : "0")}`,
    `export CHROME_LANG_FLAG=${JSON.stringify(`--lang=${locale}`)}`,
    "",
  ].join("\n"),
);

process.stdout.write(
  `Engine bootstrap ready: exitIp=${exitIp || "none"} TZ=${timezone} locale=${locale} cores=${cores} ram=${ramGb}GB proxyPort=${proxyPort || "none"}\n`,
);
