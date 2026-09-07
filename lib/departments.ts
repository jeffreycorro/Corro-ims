export const DEPARTMENT_SLUGS = [
  "admin",
  "technical",
  "finance",
  "procurement",
  "motorpool",
  "safety",
  "site",
  "hr",
] as const;

export const ROLES = ["staff", "dept_lead", "hr", "admin"] as const;

export type DepartmentSlug = (typeof DEPARTMENT_SLUGS)[number];
export type Role = (typeof ROLES)[number];

export type Department = {
  slug: DepartmentSlug;
  name: string;
  summary: string;
};

export const DEPARTMENTS: readonly Department[] = [
  {
    slug: "admin",
    name: "Admin",
    summary: "Office administration, records, and executive coordination.",
  },
  {
    slug: "technical",
    name: "Technical",
    summary: "Engineering, drawings, and project technical control.",
  },
  {
    slug: "finance",
    name: "Finance",
    summary: "Accounts, disbursements, and project cost control.",
  },
  {
    slug: "procurement",
    name: "Procurement",
    summary: "Materials, vendors, and purchase coordination.",
  },
  {
    slug: "motorpool",
    name: "Motorpool",
    summary: "Vehicles, equipment dispatch, and fleet upkeep.",
  },
  {
    slug: "safety",
    name: "Safety",
    summary: "Site safety, PPE, and compliance documentation.",
  },
  {
    slug: "site",
    name: "Site",
    summary: "Field operations, daily reports, and site coordination.",
  },
  {
    slug: "hr",
    name: "HR",
    summary: "People operations, 201 files, and employment records.",
  },
] as const;

export function isDepartmentSlug(value: string): value is DepartmentSlug {
  return (DEPARTMENT_SLUGS as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function getDepartment(slug: string): Department | undefined {
  return DEPARTMENTS.find((department) => department.slug === slug);
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "dept_lead":
      return "Department Lead";
    case "hr":
      return "HR";
    case "admin":
      return "Admin";
    default:
      return "Staff";
  }
}

export function canAccessDepartment(
  profile: { department: DepartmentSlug; role: Role } | null,
  slug: DepartmentSlug,
): boolean {
  if (!profile) return false;
  return profile.role === "admin" || profile.department === slug;
}
