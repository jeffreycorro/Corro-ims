"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildDemoSession,
  clearDemoSession,
  setDemoSession,
} from "@/lib/demo";
import { isDepartmentSlug, isRole } from "@/lib/departments";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  if (next.startsWith("/app") || next === "/settings") return next;
  return "/app";
}

export async function loginAction(formData: FormData) {
  const next = safeNext(formData.get("next"));

  if (isDemoMode()) {
    const roleValue = String(formData.get("role") ?? "admin");
    const departmentValue = String(formData.get("department") ?? "admin");
    const role = isRole(roleValue) ? roleValue : "admin";
    const department = isDepartmentSlug(departmentValue) ? departmentValue : "admin";
    await setDemoSession(buildDemoSession(role, department));
    revalidatePath("/", "layout");
    redirect(next);
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Enter%20your%20email%20and%20password.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function logoutAction() {
  if (isDemoMode()) {
    await clearDemoSession();
  } else {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  redirect("/");
}
