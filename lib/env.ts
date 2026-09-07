export const DEFAULT_HR_PORTAL_URL = "https://corcondev-hr.netlify.app";

export function isDemoMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return !url || !key;
}

export function getHrPortalUrl(): string {
  return process.env.NEXT_PUBLIC_HR_PORTAL_URL?.trim() || DEFAULT_HR_PORTAL_URL;
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
