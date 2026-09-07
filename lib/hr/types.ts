export const EMPLOYEE_DEPARTMENTS = [
  "admin",
  "technical",
  "finance",
  "procurement",
  "motorpool",
  "safety",
  "site",
  "hr",
  "unassigned",
] as const;

export type EmployeeDepartment = (typeof EMPLOYEE_DEPARTMENTS)[number];

export const EMPLOYMENT_STATUSES = [
  "Probationary",
  "Regular",
  "Project-based",
  "Fixed-term",
  "Consultant",
  "Separated",
] as const;

export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export type Sex = "Male" | "Female";
export type CivilStatus = "Single" | "Married" | "Widowed" | "Separated" | "Annulled";
export type RateType = "Daily" | "Monthly" | "Hourly";
export type ProjectStatus = "Active" | "Closed";
export type DocumentStatus = "draft" | "issued" | "void";

export type Project = {
  id: string;
  name: string;
  location: string | null;
  status: ProjectStatus;
};

export type Employee = {
  id: string;
  emp_no: string;
  name: string;
  nickname: string | null;
  birthdate: string | null;
  sex: Sex | null;
  civil_status: CivilStatus | null;
  address: string | null;
  mobile: string | null;
  email: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_number: string | null;
  sss_no: string | null;
  tin_no: string | null;
  philhealth_no: string | null;
  pagibig_no: string | null;
  bank_account: string | null;
  department: EmployeeDepartment | null;
  position: string | null;
  project: string | null;
  project_id: string | null;
  project_location: string | null;
  supervisor: string | null;
  supervisor_id: string | null;
  employment_status: EmploymentStatus | null;
  date_hired: string | null;
  contract_start: string | null;
  contract_end: string | null;
  prior_contract_no: string | null;
  regularized_on: string | null;
  daily_rate: number | null;
  rate_type: RateType | null;
  allowance: number | null;
  separated_on: string | null;
  separation_reason: string | null;
  status_basis: string | null;
  roster_confirmed: string | null;
  photo_link: string | null;
  drive_folder_id: string | null;
  drive_folder_link: string | null;
  notes: string | null;
  checklist: unknown;
};

export type DocumentSeries = {
  key: string;
  label: string;
  prefix: string;
  padding: number;
  reset_yearly: boolean;
  pattern: string;
};

export type CompanySettings = {
  id: number;
  company_name: string;
  address: string;
  tin: string | null;
  document_prefix: string;
  hr_officer_name: string | null;
  hr_officer_title: string | null;
  admin_head_name: string | null;
  admin_head_title: string | null;
  finance_officer_name: string | null;
  finance_officer_title: string | null;
  ceo_name: string | null;
  ceo_title: string | null;
  probation_warning_days: number;
  contract_end_warning_days: number;
  document_expiry_warning_days: number;
  nte_answer_days: number;
  discipline_lookback_months: number;
  cash_advance_liquidate_days: number;
  workdays_per_period: number;
  overtime_multiplier: number;
};

export const EMPLOYEE_DEPARTMENT_LABELS: Record<EmployeeDepartment, string> = {
  admin: "Admin",
  technical: "Technical",
  finance: "Finance",
  procurement: "Procurement",
  motorpool: "Motorpool",
  safety: "Safety",
  site: "Site",
  hr: "HR",
  unassigned: "Unassigned",
};

export function employeeDepartmentLabel(value: EmployeeDepartment | null | undefined): string {
  if (!value) return "—";
  return EMPLOYEE_DEPARTMENT_LABELS[value] ?? value;
}

export function employmentStatusLabel(value: EmploymentStatus | null | undefined): string {
  if (!value) return "Unclassified";
  return value;
}
