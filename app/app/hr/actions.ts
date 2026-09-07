"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { canAccessHr } from "@/lib/hr/access";
import { setDemoSettings } from "@/lib/hr/demo-settings";
import type { CompanySettings } from "@/lib/hr/types";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

function int(formData: FormData, key: string, fallback: number): number {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function decimal(formData: FormData, key: string, fallback: number): number {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function settingsFromForm(formData: FormData): CompanySettings {
  return {
    id: 1,
    company_name: text(formData, "company_name") ?? "CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION",
    address: text(formData, "address") ?? "",
    tin: text(formData, "tin"),
    document_prefix: text(formData, "document_prefix") ?? "CCDTC",
    hr_officer_name: text(formData, "hr_officer_name"),
    hr_officer_title: text(formData, "hr_officer_title"),
    admin_head_name: text(formData, "admin_head_name"),
    admin_head_title: text(formData, "admin_head_title"),
    finance_officer_name: text(formData, "finance_officer_name"),
    finance_officer_title: text(formData, "finance_officer_title"),
    ceo_name: text(formData, "ceo_name"),
    ceo_title: text(formData, "ceo_title"),
    probation_warning_days: int(formData, "probation_warning_days", 30),
    contract_end_warning_days: int(formData, "contract_end_warning_days", 30),
    document_expiry_warning_days: int(formData, "document_expiry_warning_days", 60),
    nte_answer_days: int(formData, "nte_answer_days", 5),
    discipline_lookback_months: int(formData, "discipline_lookback_months", 12),
    cash_advance_liquidate_days: int(formData, "cash_advance_liquidate_days", 15),
    workdays_per_period: int(formData, "workdays_per_period", 13),
    overtime_multiplier: decimal(formData, "overtime_multiplier", 1),
  };
}

export async function saveHrSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canAccessHr(user)) {
    throw new Error("HR access required.");
  }

  const settings = settingsFromForm(formData);

  if (isDemoMode()) {
    await setDemoSettings(settings);
    revalidatePath("/app/hr");
    revalidatePath("/app/hr/settings");
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert(settings, { onConflict: "id" });
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/app/hr");
  revalidatePath("/app/hr/settings");
}
