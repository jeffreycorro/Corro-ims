import { cookies } from "next/headers";
import {
  type DepartmentSlug,
  type Role,
  isDepartmentSlug,
  isRole,
} from "@/lib/departments";

export const DEMO_COOKIE = "ccd_demo_session";

export type DemoSession = {
  full_name: string;
  email: string;
  department: DepartmentSlug;
  role: Role;
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildDemoSession(role: Role, department: DepartmentSlug): DemoSession {
  const label = role === "admin" ? "Administrator" : `${titleCase(department)} ${titleCase(role)}`;
  return {
    full_name: `Demo ${label}`,
    email: `demo.${role}.${department}@corcondev.local`,
    department,
    role,
  };
}

export function parseDemoSession(raw: string | undefined): DemoSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<DemoSession>;
    if (
      typeof parsed.full_name !== "string" ||
      typeof parsed.email !== "string" ||
      !parsed.department ||
      !parsed.role ||
      !isDepartmentSlug(parsed.department) ||
      !isRole(parsed.role)
    ) {
      return null;
    }
    return {
      full_name: parsed.full_name,
      email: parsed.email,
      department: parsed.department,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export async function getDemoSession(): Promise<DemoSession | null> {
  const store = await cookies();
  return parseDemoSession(store.get(DEMO_COOKIE)?.value);
}

export async function setDemoSession(session: DemoSession): Promise<void> {
  const store = await cookies();
  store.set(DEMO_COOKIE, encodeURIComponent(JSON.stringify(session)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearDemoSession(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
}
