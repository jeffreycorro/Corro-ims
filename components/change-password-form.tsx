"use client";

import { useActionState, useEffect } from "react";
import { changePasswordAction, type ChangePasswordState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

const initialState: ChangePasswordState = {
  ok: false,
  message: null,
  stamp: 0,
};

const fieldClassName =
  "h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2 disabled:bg-navy-50 disabled:text-navy-600";

export function ChangePasswordForm({ isDemo }: { isDemo: boolean }) {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  useEffect(() => {
    if (window.location.hash === "#password") {
      document.getElementById("password")?.scrollIntoView({ block: "start" });
    }
  }, []);

  return (
    <form key={state.ok ? state.stamp : "form"} action={formAction} className="space-y-4">
      {isDemo ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-navy-900">
          Demo mode uses a mock session, so passwords are not stored or updated. Sign in with
          Supabase Auth to change a real account password.
        </p>
      ) : null}

      {state.message ? (
        <p
          className={
            state.ok
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          }
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-navy-900">Current password</span>
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          disabled={isDemo}
          className={fieldClassName}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-navy-900">New password</span>
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={isDemo}
          className={fieldClassName}
        />
        <span className="mt-1 block text-xs text-muted">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-navy-900">Confirm new password</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={isDemo}
          className={fieldClassName}
        />
      </label>

      <SubmitButton
        pendingLabel="Updating password…"
        disabled={isDemo}
        className="inline-flex h-11 items-center justify-center rounded-md bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
      >
        Update password
      </SubmitButton>
    </form>
  );
}
