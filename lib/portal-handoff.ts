export function portalHandoffUrl(
  baseUrl: string,
  accessToken?: string | null,
): string {
  const trimmed = (baseUrl || "").trim();
  if (!trimmed) return "/";
  if (!accessToken) return trimmed;
  try {
    const url = new URL(trimmed);
    url.hash = `access_token=${encodeURIComponent(accessToken)}`;
    return url.toString();
  } catch {
    const path = trimmed.split("#")[0];
    return `${path}#access_token=${encodeURIComponent(accessToken)}`;
  }
}
