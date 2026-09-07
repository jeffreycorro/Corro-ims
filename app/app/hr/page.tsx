import { Suspense } from "react";
import { HrDenied, HrNav, DataWarning } from "@/app/app/hr/hr-chrome";
import { HrRegister } from "@/app/app/hr/register-client";
import { requireUser } from "@/lib/auth";
import { canAccessHr } from "@/lib/hr/access";
import { loadHrFoundation } from "@/lib/hr/load";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "201 File Register",
};

type SearchParams = Promise<{ emp?: string }>;

export default async function HrRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await loadHrFoundation();
  const allowed = canAccessHr(user);

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8">
      <HrNav current="register" />
      {!allowed ? (
        <HrDenied />
      ) : (
        <>
          <DataWarning
            message={
              data.warning ??
              (data.source === "demo"
                ? "Sample roster (demo / fallback). Apply the HR migration when Supabase is configured."
                : null)
            }
          />
          <Suspense
            fallback={
              <div className="rounded-xl border border-navy-100 bg-white px-5 py-10 text-sm text-muted">
                Loading register…
              </div>
            }
          >
            <HrRegister employees={data.employees} initialEmpNo={params.emp} />
          </Suspense>
          <aside className="mt-4 rounded-lg border border-navy-100 bg-white px-5 py-4">
            <p className="text-xs font-semibold tracking-[0.18em] text-amber-600">RESERVED</p>
            <p className="mt-1 font-medium text-navy-900">Department Assistant — soon</p>
            <p className="mt-1 text-sm text-muted">
              A small assistant slot is reserved here. Chat is out of scope for this phase.
            </p>
          </aside>
        </>
      )}
    </main>
  );
}
