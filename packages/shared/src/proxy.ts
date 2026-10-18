/** Mask credentials in http(s) proxy URLs for logs/API. */
export function maskProxyUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    if (parsed.username) parsed.username = parsed.username.slice(0, 2) + "****";
    return parsed.toString();
  } catch {
    return "****";
  }
}
