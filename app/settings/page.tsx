import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { formatManilaDateTime } from "@/lib/dates";
import { getDepartment, roleLabel } from "@/lib/departments";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const user = await requireUser();
  const department = user.profile ? getDepartment(user.profile.department) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-navy-50">
      <SiteHeader user={user} variant="portal" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <p className="text-xs font-semibold tracking-[0.22em] text-amber-500">ACCOUNT</p>
        <h1 className="mt-2 font-display text-3xl text-navy-950">Profile</h1>
        <p className="mt-2 text-muted">
          Profile data is managed by administrators. Staff can view their own record.
        </p>

        <dl className="mt-8 divide-y divide-navy-100 rounded-xl border border-navy-100 bg-white shadow-sm">
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Full name</dt>
            <dd>{user.profile?.full_name ?? "Not provisioned"}</dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Department</dt>
            <dd>{department?.name ?? "—"}</dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Role</dt>
            <dd>{user.profile ? roleLabel(user.profile.role) : "—"}</dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Session</dt>
            <dd>{user.isDemo ? "Demo mode (mock session)" : "Supabase Auth"}</dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
            <dt className="text-sm font-medium text-navy-700">Local time</dt>
            <dd>{formatManilaDateTime()}</dd>
          </div>
        </dl>

        {user.profile?.role === "admin" ||
        user.profile?.role === "hr" ||
        user.profile?.department === "hr" ? (
          <p className="mt-6 text-sm">
            <Link href="/app/hr/settings" className="text-navy-700 underline-offset-2 hover:underline">
              HR company constants
            </Link>
          </p>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
