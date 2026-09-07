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
import { validatePasswordChange } from "@/lib/password";
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

export type ChangePasswordState = {
  ok: boolean;
  message: string | null;
  stamp: number;
};

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const stamp = Date.now();

  if (isDemoMode()) {
    return {
      ok: false,
      stamp,
      message:
        "Demo mode uses a mock session. Sign in with Supabase Auth to change a real password.",
    };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const validationError = validatePasswordChange({
    currentPassword,
    newPassword,
    confirmPassword,
  });

  if (validationError) {
    return { ok: false, stamp, message: validationError };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { ok: false, stamp, message: "You must be signed in to change your password." };
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (reauthError) {
    return { ok: false, stamp, message: "Current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    return { ok: false, stamp, message: error.message };
  }

  return {
    ok: true,
    stamp,
    message: "Password updated. Use the new password the next time you sign in.",
  };
}
