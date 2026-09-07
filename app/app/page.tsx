import Link from "next/link";
import { DepartmentIcon } from "@/components/department-icons";
import { requireUser } from "@/lib/auth";
import { formatManilaDate } from "@/lib/dates";
import { canAccessDepartment, DEPARTMENTS } from "@/lib/departments";

export const metadata = {
  title: "Department hub",
};

export default async function HubPage() {
  const user = await requireUser();
  const isAdmin = user.profile?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-amber-500">PORTAL</p>
          <h1 className="mt-2 font-display text-3xl text-navy-950 sm:text-4xl">
            Department hub
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            {isAdmin
              ? "Administrator access — every department workspace is available."
              : user.profile
                ? `You can open ${DEPARTMENTS.find((item) => item.slug === user.profile?.department)?.name ?? "your"} only.`
                : "Your account is signed in, but a profile has not been provisioned yet."}
          </p>
        </div>
        <p className="text-sm text-muted">{formatManilaDate()}</p>
      </div>

      {!user.profile ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-navy-900">
          Ask an administrator to create your <code className="font-semibold">profiles</code> row
          before department modules can be opened.
        </div>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {DEPARTMENTS.map((department) => {
          const allowed = canAccessDepartment(user.profile, department.slug);

          const body = (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy-50 text-navy-900">
                <DepartmentIcon slug={department.slug} />
              </span>
              <span className="mt-4 block font-display text-xl text-navy-950">
                {department.name}
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-muted">
                {department.summary}
              </span>
              <span
                className={`mt-5 block text-xs font-semibold tracking-[0.16em] ${
                  allowed ? "text-amber-600" : "text-navy-600"
                }`}
              >
                {allowed
                  ? department.slug === "hr"
                    ? "OPEN 201 FILE REGISTER"
                    : "OPEN WORKSPACE"
                  : "NO ACCESS"}
              </span>
            </>
          );

          return (
            <li key={department.slug} className="min-h-[13.5rem]">
              {allowed ? (
                <Link
                  href={`/app/${department.slug}`}
                  className="block h-full min-h-44 rounded-xl border border-navy-100 bg-white p-5 shadow-sm transition-colors hover:border-amber-400"
                >
                  {body}
                </Link>
              ) : (
                <div
                  className="block h-full rounded-xl border border-navy-100 bg-white/70 p-5 opacity-60"
                  aria-disabled="true"
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
