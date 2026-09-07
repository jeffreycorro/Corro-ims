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
    <header className="border-b border-white/10 bg-navy-950 text-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href={user ? "/app" : "/"} className="flex items-center gap-3">
          <BrandMark className="h-8 w-8 shrink-0" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-[0.18em]">CORCONDEV</span>
            <span className="block text-[11px] text-navy-200">Company Portal</span>
          </span>
        </Link>

        {variant === "public" ? (
          <Link
            href={user ? "/app" : "/login"}
            className="inline-flex h-10 items-center rounded-md bg-amber-400 px-4 text-sm font-semibold text-navy-950"
          >
            {user ? "Open portal" : "Login"}
          </Link>
        ) : (
          <div className="flex items-center gap-3 sm:gap-5">
            {user?.profile ? (
              <p className="hidden text-right text-sm leading-tight sm:block">
                <span className="block font-medium">{user.profile.full_name}</span>
                <span className="block text-xs text-navy-200">
                  {roleLabel(user.profile.role)} · {getDepartment(user.profile.department)?.name}
                </span>
              </p>
            ) : null}
            <Link href="/settings" className="text-sm text-navy-100 hover:text-white">
              Settings
            </Link>
            <Link href="/settings#password" className="text-sm text-navy-100 hover:text-white">
              <span className="sm:hidden">Password</span>
              <span className="hidden sm:inline">Change password</span>
            </Link>
            <form action={logoutAction}>
              <SubmitButton
                pendingLabel="Signing out…"
                className="text-sm text-navy-100 hover:text-white disabled:opacity-60"
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
