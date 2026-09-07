import type { AuthUser } from "@/lib/auth";
import { canAccessDepartment } from "@/lib/departments";

export function canAccessHr(user: AuthUser | null): boolean {
  if (!user?.profile) return false;
  return (
    user.profile.role === "admin" ||
    user.profile.role === "hr" ||
    user.profile.department === "hr" ||
    canAccessDepartment(user.profile, "hr")
  );
}
