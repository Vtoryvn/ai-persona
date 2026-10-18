import { readFileSync } from "node:fs";
import ProxyChain from "proxy-chain";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { MissionRequest } from "@persona-system/shared";

export interface ProxyGeo {
  timezone: string;
  locale: string;
  lat: number;
  lon: number;
  countryCode: string;
}

const GEO_CACHE = new Map<string, { at: number; geo: ProxyGeo }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** BCP-47 locale per ISO country when ip-api does not return languages. */
const COUNTRY_LOCALE: Record<string, string> = {
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
  RU: "ru-RU",
  UA: "uk-UA",
  TR: "tr-TR",
  SE: "sv-SE",
  NO: "nb-NO",
  DK: "da-DK",
  FI: "fi-FI",
  CH: "de-CH",
  AT: "de-AT",
  BE: "nl-BE",
  PT: "pt-PT",
  IE: "en-IE",
  NZ: "en-NZ",
  ZA: "en-ZA",
  AE: "ar-AE",
  IL: "he-IL",
};

function cacheKey(proxyUrl: string): string {
  return proxyUrl.replace(/:[^:@/]+@/, ":****@");
}

function readLocalProxyFile(): string {
  try {
    return readFileSync("/tmp/local-proxy.url", "utf8").trim();
  } catch {
    return "";
  }
}

export function resolveProxyUrlForGeo(mission: MissionRequest): string {
  return (
    process.env.PERSONA_LOCAL_PROXY_URL?.trim() ||
    readLocalProxyFile() ||
    mission.browser?.proxyUrl?.trim() ||
    process.env.BROWSER_PROXY_URL?.trim() ||
    ""
  );
}

export function shouldMatchProxyGeo(mission: MissionRequest): boolean {
  const browser = mission.browser ?? {};
  if (browser.matchProxyGeo === false) return false;
  return Boolean(resolveProxyUrlForGeo(mission));
}

async function withProxyDispatcher(
  proxyUrl: string,
): Promise<{ dispatcher: ProxyAgent; cleanup: () => Promise<void> }> {
  let local = proxyUrl;
  let ownsAnonymized = false;
  if (/^https?:\/\//i.test(proxyUrl) && proxyUrl.includes("@")) {
    local = await ProxyChain.anonymizeProxy(proxyUrl);
    ownsAnonymized = true;
  }
  const dispatcher = new ProxyAgent(local);
  const cleanup = async () => {
    await dispatcher.close?.();
    if (ownsAnonymized) await ProxyChain.closeAnonymizedProxy(local, true);
  };
  return { dispatcher, cleanup };
}

function localeFromCountry(countryCode: string): string {
  const cc = countryCode.toUpperCase();
  return COUNTRY_LOCALE[cc] ?? `en-${cc}`;
}

async function fetchGeoThroughProxy(proxyUrl: string): Promise<ProxyGeo | null> {
  const key = cacheKey(proxyUrl);
  const cached = GEO_CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.geo;

  const { dispatcher, cleanup } = await withProxyDispatcher(proxyUrl);
  try {
    const endpoints = [
      "http://ip-api.com/json/?fields=status,timezone,countryCode,lat,lon",
      "https://ipapi.co/json/",
    ];
    for (const url of endpoints) {
      try {
        const res = await undiciFetch(url, {
          dispatcher,
          signal: AbortSignal.timeout(20_000),
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as Record<string, unknown>;
        if (url.includes("ip-api.com")) {
          if (data.status !== "success") continue;
          const countryCode = String(data.countryCode ?? "US");
          const geo: ProxyGeo = {
            timezone: String(data.timezone ?? "UTC"),
            countryCode,
            locale: localeFromCountry(countryCode),
            lat: Number(data.lat),
            lon: Number(data.lon),
          };
          if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) continue;
          GEO_CACHE.set(key, { at: Date.now(), geo });
          return geo;
        }
        const countryCode = String(data.country_code ?? data.country ?? "US").slice(0, 2);
        const geo: ProxyGeo = {
          timezone: String(data.timezone ?? "UTC"),
          countryCode: countryCode.toUpperCase(),
          locale: localeFromCountry(countryCode),
          lat: Number(data.latitude),
          lon: Number(data.longitude),
        };
        if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) continue;
        GEO_CACHE.set(key, { at: Date.now(), geo });
        return geo;
      } catch {
        // try next provider
      }
    }
    return null;
  } finally {
    await cleanup();
  }
}

/** Resolve timezone/locale/geolocation from the proxy egress IP (same path Chrome uses). */
export async function resolveProxyGeo(mission: MissionRequest): Promise<ProxyGeo | null> {
  const proxyUrl = resolveProxyUrlForGeo(mission);
  if (!proxyUrl) return null;
  return fetchGeoThroughProxy(proxyUrl);
}
