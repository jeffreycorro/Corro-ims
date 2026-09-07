import {
  DEMO_DOCUMENT_SERIES,
  DEMO_EMPLOYEES,
  DEMO_PROJECTS,
} from "@/lib/hr/demo-data";
import { getDemoSettings } from "@/lib/hr/demo-settings";
import { toNumber } from "@/lib/hr/money";
import type {
  CompanySettings,
  DocumentSeries,
  Employee,
  EmployeeDepartment,
  EmploymentStatus,
  Project,
  ProjectStatus,
  RateType,
  Sex,
  CivilStatus,
} from "@/lib/hr/types";
import { EMPLOYEE_DEPARTMENTS, EMPLOYMENT_STATUSES } from "@/lib/hr/types";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type HrFoundation = {
  source: "supabase" | "demo";
  warning: string | null;
  employees: Employee[];
  projects: Project[];
  settings: CompanySettings;
  series: DocumentSeries[];
};

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function mapEmployee(row: Record<string, unknown>): Employee {
  return {
    id: String(row.id),
    emp_no: String(row.emp_no),
    name: String(row.name),
    nickname: (row.nickname as string | null) ?? null,
    birthdate: (row.birthdate as string | null) ?? null,
    sex: asEnum<Sex>(row.sex, ["Male", "Female"]),
    civil_status: asEnum<CivilStatus>(row.civil_status, [
      "Single",
      "Married",
      "Widowed",
      "Separated",
      "Annulled",
    ]),
    address: (row.address as string | null) ?? null,
    mobile: (row.mobile as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    emergency_name: (row.emergency_name as string | null) ?? null,
    emergency_relation: (row.emergency_relation as string | null) ?? null,
    emergency_number: (row.emergency_number as string | null) ?? null,
    sss_no: (row.sss_no as string | null) ?? null,
    tin_no: (row.tin_no as string | null) ?? null,
    philhealth_no: (row.philhealth_no as string | null) ?? null,
    pagibig_no: (row.pagibig_no as string | null) ?? null,
    bank_account: (row.bank_account as string | null) ?? null,
    department: asEnum<EmployeeDepartment>(row.department, EMPLOYEE_DEPARTMENTS),
    position: (row.position as string | null) ?? null,
    project: (row.project as string | null) ?? null,
    project_id: (row.project_id as string | null) ?? null,
    project_location: (row.project_location as string | null) ?? null,
    supervisor: (row.supervisor as string | null) ?? null,
    supervisor_id: (row.supervisor_id as string | null) ?? null,
    employment_status: asEnum<EmploymentStatus>(row.employment_status, EMPLOYMENT_STATUSES),
    date_hired: (row.date_hired as string | null) ?? null,
    contract_start: (row.contract_start as string | null) ?? null,
    contract_end: (row.contract_end as string | null) ?? null,
    prior_contract_no: (row.prior_contract_no as string | null) ?? null,
    regularized_on: (row.regularized_on as string | null) ?? null,
    daily_rate: toNumber(row.daily_rate),
    rate_type: asEnum<RateType>(row.rate_type, ["Daily", "Monthly", "Hourly"]),
    allowance: toNumber(row.allowance),
    separated_on: (row.separated_on as string | null) ?? null,
    separation_reason: (row.separation_reason as string | null) ?? null,
    status_basis: (row.status_basis as string | null) ?? null,
    roster_confirmed: (row.roster_confirmed as string | null) ?? null,
    photo_link: (row.photo_link as string | null) ?? null,
    drive_folder_id: (row.drive_folder_id as string | null) ?? null,
    drive_folder_link: (row.drive_folder_link as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    checklist: row.checklist ?? [],
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    location: (row.location as string | null) ?? null,
    status: (row.status === "Closed" ? "Closed" : "Active") as ProjectStatus,
  };
}

function mapSeries(row: Record<string, unknown>): DocumentSeries {
  return {
    key: String(row.key),
    label: String(row.label),
    prefix: String(row.prefix ?? ""),
    padding: toNumber(row.padding) ?? 4,
    reset_yearly: Boolean(row.reset_yearly),
    pattern: String(row.pattern),
  };
}

function mapSettings(row: Record<string, unknown>): CompanySettings {
  return {
    id: 1,
    company_name: String(row.company_name),
    address: String(row.address),
    tin: (row.tin as string | null) ?? null,
    document_prefix: String(row.document_prefix ?? "CCDTC"),
    hr_officer_name: (row.hr_officer_name as string | null) ?? null,
    hr_officer_title: (row.hr_officer_title as string | null) ?? null,
    admin_head_name: (row.admin_head_name as string | null) ?? null,
    admin_head_title: (row.admin_head_title as string | null) ?? null,
    finance_officer_name: (row.finance_officer_name as string | null) ?? null,
    finance_officer_title: (row.finance_officer_title as string | null) ?? null,
    ceo_name: (row.ceo_name as string | null) ?? null,
    ceo_title: (row.ceo_title as string | null) ?? null,
    probation_warning_days: toNumber(row.probation_warning_days) ?? 30,
    contract_end_warning_days: toNumber(row.contract_end_warning_days) ?? 30,
    document_expiry_warning_days: toNumber(row.document_expiry_warning_days) ?? 60,
    nte_answer_days: toNumber(row.nte_answer_days) ?? 5,
    discipline_lookback_months: toNumber(row.discipline_lookback_months) ?? 12,
    cash_advance_liquidate_days: toNumber(row.cash_advance_liquidate_days) ?? 15,
    workdays_per_period: toNumber(row.workdays_per_period) ?? 13,
    overtime_multiplier: toNumber(row.overtime_multiplier) ?? 1,
  };
}

async function demoFoundation(warning: string | null): Promise<HrFoundation> {
  const settings = await getDemoSettings();
  return {
    source: "demo",
    warning,
    employees: [...DEMO_EMPLOYEES].sort((a, b) => a.name.localeCompare(b.name)),
    projects: DEMO_PROJECTS,
    settings,
    series: DEMO_DOCUMENT_SERIES,
  };
}

export async function loadHrFoundation(): Promise<HrFoundation> {
  if (isDemoMode()) {
    return demoFoundation(null);
  }

  try {
    const supabase = await createClient();
    const [employeesRes, projectsRes, settingsRes, seriesRes] = await Promise.all([
      supabase.from("employees").select("*").order("name"),
      supabase.from("projects").select("*").order("name"),
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("document_series").select("*").order("key"),
    ]);

    const error =
      employeesRes.error?.message ||
      projectsRes.error?.message ||
      settingsRes.error?.message ||
      seriesRes.error?.message;

    if (error) {
      return demoFoundation(
        `Supabase HR tables are not available (${error}). Showing the sample roster so the Register can be reviewed. Apply supabase/migrations/20260907000002_hr_201_foundation.sql.`,
      );
    }

    const employees = ((employeesRes.data ?? []) as Record<string, unknown>[]).map(mapEmployee);
    const projects = ((projectsRes.data ?? []) as Record<string, unknown>[]).map(mapProject);
    const series = ((seriesRes.data ?? []) as Record<string, unknown>[]).map(mapSeries);
    const settings = settingsRes.data
      ? mapSettings(settingsRes.data as Record<string, unknown>)
      : (await demoFoundation(null)).settings;

    return {
      source: "supabase",
      warning: employees.length === 0 ? "No employee rows yet. Seed data is in the HR migration." : null,
      employees,
      projects,
      settings,
      series,
    };
  } catch {
    return demoFoundation(
      "Could not reach Supabase. Showing the sample roster so the Register can be reviewed.",
    );
  }
}
