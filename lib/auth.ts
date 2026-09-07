import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/demo";
import type { DepartmentSlug, Role } from "@/lib/departments";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  full_name: string;
  department: DepartmentSlug;
  role: Role;
};

export type AuthUser = {
  id: string;
  email: string;
  profile: Profile | null;
  isDemo: boolean;
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isDemoMode()) {
    const demo = await getDemoSession();
    if (!demo) return null;
    return {
      id: "demo-user",
      email: demo.email,
      profile: {
        full_name: demo.full_name,
        department: demo.department,
        role: demo.role,
      },
      isDemo: true,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, department, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    profile: profile
      ? {
          full_name: profile.full_name,
          department: profile.department,
          role: profile.role,
        }
      : null,
    isDemo: false,
  };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
