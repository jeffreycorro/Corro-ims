import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BrandMark } from "@/components/brand-mark";
import { DepartmentIcon } from "@/components/department-icons";
import { getCurrentUser } from "@/lib/auth";
import { formatManilaDate, formatManilaTime } from "@/lib/dates";
import { DEPARTMENTS } from "@/lib/departments";

export default async function LandingPage() {
  const user = await getCurrentUser();
  const now = new Date();

  return (
    <div className="min-h-dvh bg-navy-950 text-white">
      <SiteHeader user={user} variant="public" />

      <main>
        <section className="relative overflow-hidden">
          <div className="blueprint-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid min-h-[calc(100dvh-8.5rem)] max-w-6xl items-center gap-12 px-5 py-16 pb-[max(4rem,env(safe-area-inset-bottom))] lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
            <div>
              <p className="mb-5 text-xs font-semibold tracking-[0.28em] text-amber-400">
                INTERNAL OPERATIONS
              </p>
              <h1 className="font-display text-4xl leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.5rem]">
                Corro Construction
                <span className="block">Development and Trade</span>
                <span className="block">Corporation</span>
              </h1>
              <div className="mt-6 h-1 w-16 bg-amber-400" />
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-navy-200">
                Company portal for office and site staff in Cebu City. Sign in to open your
                department workspace.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href={user ? "/app" : "/login"}
                  className="inline-flex h-12 min-w-[7.5rem] items-center justify-center rounded-md bg-amber-400 px-6 text-sm font-semibold text-navy-950"
                >
                  {user ? "Open portal" : "Login"}
                </Link>
                <p className="text-sm text-navy-300">Authorized personnel only</p>
              </div>
            </div>

            <aside className="min-w-0 rounded-xl border border-white/10 bg-navy-900/80 p-6 shadow-[0_24px_80px_rgb(0_0_0_/_0.28)]">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <BrandMark className="h-10 w-10" />
                  <div>
                    <p className="text-sm font-semibold tracking-[0.16em]">CORCONDEV</p>
                    <p className="text-xs text-navy-300">Cebu City, Philippines</p>
                  </div>
                </div>
                <p className="text-right text-xs text-navy-300">
                  <span className="block font-medium text-white">{formatManilaTime(now)}</span>
                  <span className="block">{formatManilaDate(now)}</span>
                </p>
              </div>

              <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-navy-300">
                DEPARTMENTS
              </p>
              <ul className="grid grid-cols-2 gap-2">
                {DEPARTMENTS.map((department) => (
                  <li
                    key={department.slug}
                    className="flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-lg border border-white/8 bg-navy-800/70 px-3 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-950 text-amber-400">
                      <DepartmentIcon slug={department.slug} className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{department.name}</span>
                      <span className="block text-[11px] leading-snug text-navy-300">
                        {department.slug === "hr" ? "201 File next" : "Workspace"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
