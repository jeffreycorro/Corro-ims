import Link from "next/link";
import { notFound } from "next/navigation";
import { DepartmentIcon } from "@/components/department-icons";
import { requireUser } from "@/lib/auth";
import { canAccessDepartment, getDepartment, isDepartmentSlug } from "@/lib/departments";
import { getHrPortalUrl } from "@/lib/env";

type Params = Promise<{ department: string }>;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Params }) {
  const { department } = await params;
  const meta = getDepartment(department);
  return { title: meta?.name ?? "Department" };
}

export default async function DepartmentPage({ params }: { params: Params }) {
  const user = await requireUser();
  const { department: slug } = await params;

  if (!isDepartmentSlug(slug)) {
    notFound();
  }

  const department = getDepartment(slug);
  if (!department) notFound();

  const allowed = canAccessDepartment(user.profile, slug);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <p className="mb-4 text-sm">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center text-navy-700 underline-offset-2 hover:underline"
        >
          ← Department hub
        </Link>
      </p>

      <div className="rounded-xl border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-navy-50 text-navy-900">
            <DepartmentIcon slug={department.slug} className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-amber-500">DEPARTMENT</p>
            <h1 className="mt-1 font-display text-3xl text-navy-950">{department.name}</h1>
            <p className="mt-2 max-w-2xl text-muted">{department.summary}</p>
          </div>
        </div>

        {!allowed ? (
          <p className="mt-8 rounded-md border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-800">
            This workspace is gated. Your account is assigned to another department. Ask an
            administrator if you need access.
          </p>
        ) : (
          <div className="mt-8 space-y-4">
            {department.slug === "hr" ? (
              <div className="rounded-lg border border-navy-200 bg-navy-50 px-5 py-6">
                <p className="text-xs font-semibold tracking-[0.18em] text-amber-600">LIVE</p>
                <h2 className="mt-2 font-display text-2xl text-navy-950">
                  HR 201 File Register
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  People operations and 201 files live on the HR portal — a separate site, not
                  rebuilt inside this workspace. Open it to continue.
                </p>
                <a
                  href={getHrPortalUrl()}
                  className="mt-5 inline-flex h-11 items-center justify-center rounded-md bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-800"
                >
                  Open HR 201 File Register
                </a>
                <p className="mt-3 text-xs text-muted">Opens the live HR site in this tab.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50 px-5 py-6">
                <p className="text-xs font-semibold tracking-[0.18em] text-navy-600">MODULE</p>
                <h2 className="mt-2 font-display text-2xl text-navy-950">Module coming soon</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  This department home is a placeholder for the first operations build. Records,
                  registers, and workflows will land here later.
                </p>
              </div>
            )}

            <aside className="rounded-lg border border-navy-100 bg-white px-5 py-4">
              <p className="text-xs font-semibold tracking-[0.18em] text-amber-600">RESERVED</p>
              <p className="mt-1 font-medium text-navy-900">Department Assistant — soon</p>
              <p className="mt-1 text-sm text-muted">
                A small assistant slot is reserved here. Chat is out of scope for this phase.
              </p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
