import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { SubmitButton } from "@/components/submit-button";
import { getCurrentUser } from "@/lib/auth";
import { DEPARTMENTS, ROLES, roleLabel } from "@/lib/departments";
import { isDemoMode } from "@/lib/env";

type SearchParams = Promise<{ error?: string; next?: string }>;

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = params.next && (params.next.startsWith("/app") || params.next === "/settings")
    ? params.next
    : "/app";

  if (user) {
    redirect(next);
  }

  const demo = isDemoMode();

  return (
    <div className="min-h-dvh bg-navy-50">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
        <Link href="/" className="mb-8 flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <span>
            <span className="block text-sm font-semibold tracking-[0.18em] text-navy-900">
              CORCONDEV
            </span>
            <span className="block text-sm text-muted">Sign in to the company portal</span>
          </span>
        </Link>

        <div className="rounded-xl border border-navy-100 bg-white p-6 shadow-sm">
          {demo ? (
            <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-navy-900">
              <p className="font-semibold">DEMO MODE</p>
              <p className="mt-1 text-muted">
                Choose a role and department to review gating. Password is not required.
              </p>
            </div>
          ) : null}

          {params.error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {params.error}
            </p>
          ) : null}

          <form action={loginAction} className="space-y-4">
            <input type="hidden" name="next" value={next} />

            {!demo ? (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy-900">Email</span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    className="h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy-900">Password</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    className="h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy-900">Role</span>
                  <select
                    name="role"
                    defaultValue="admin"
                    className="h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy-900">
                    Department
                  </span>
                  <select
                    name="department"
                    defaultValue="admin"
                    className="h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2"
                  >
                    {DEPARTMENTS.map((department) => (
                      <option key={department.slug} value={department.slug}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <SubmitButton
              pendingLabel="Signing in…"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-navy-900 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
            >
              {demo ? "Enter demo portal" : "Sign in"}
            </SubmitButton>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/" className="text-navy-700 underline-offset-2 hover:underline">
            Back to company landing
          </Link>
        </p>
      </div>
    </div>
  );
}
