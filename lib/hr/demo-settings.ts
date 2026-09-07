import { cookies } from "next/headers";
import { DEMO_SETTINGS } from "./demo-data";
import type { CompanySettings } from "./types";

export const DEMO_SETTINGS_COOKIE = "ccd_demo_hr_settings";

export function parseDemoSettings(raw: string | undefined): CompanySettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<CompanySettings>;
    if (typeof parsed.company_name !== "string" || typeof parsed.address !== "string") {
      return null;
    }
    return {
      ...DEMO_SETTINGS,
      ...parsed,
      id: 1,
    };
  } catch {
    return null;
  }
}

export async function getDemoSettings(): Promise<CompanySettings> {
  const store = await cookies();
  return parseDemoSettings(store.get(DEMO_SETTINGS_COOKIE)?.value) ?? DEMO_SETTINGS;
}

export async function setDemoSettings(settings: CompanySettings): Promise<void> {
  const store = await cookies();
  store.set(DEMO_SETTINGS_COOKIE, encodeURIComponent(JSON.stringify(settings)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
