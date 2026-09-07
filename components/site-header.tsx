import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { SubmitButton } from "@/components/submit-button";
import type { AuthUser } from "@/lib/auth";
import { getDepartment, roleLabel } from "@/lib/departments";

export function SiteHeader({
  user,
  variant = "portal",
}: {
  user: AuthUser | null;
  variant?: "public" | "portal";
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950 text-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-5 py-2 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]">
        <Link href={user ? "/app" : "/"} className="flex min-h-11 min-w-0 items-center gap-3">
          <BrandMark className="h-8 w-8 shrink-0" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-[0.18em]">CORCONDEV</span>
            <span className="block text-[11px] text-navy-200">Company Portal</span>
          </span>
        </Link>

        {variant === "public" ? (
          <Link
            href={user ? "/app" : "/login"}
            className="inline-flex h-11 shrink-0 items-center rounded-md bg-amber-400 px-4 text-sm font-semibold text-navy-950"
          >
            {user ? "Open portal" : "Login"}
          </Link>
        ) : (
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            {user?.profile ? (
              <p className="hidden text-right text-sm leading-tight sm:block">
                <span className="block font-medium">{user.profile.full_name}</span>
                <span className="block text-xs text-navy-200">
                  {roleLabel(user.profile.role)} · {getDepartment(user.profile.department)?.name}
                </span>
              </p>
            ) : null}
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center justify-center px-3 text-sm text-navy-100 hover:text-white"
            >
              Settings
            </Link>
            <form action={logoutAction}>
              <SubmitButton
                pendingLabel="Signing out…"
                className="inline-flex min-h-11 items-center justify-center px-3 text-sm text-navy-100 hover:text-white disabled:opacity-60"
              >
                Sign out
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
