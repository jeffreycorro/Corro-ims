import Link from "next/link";
import { formatCalendarDate, manilaTodayYmd } from "@/lib/dates";

export function HrNav({ current }: { current: "register" | "settings" }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-3 text-sm">
          <Link href="/app" className="text-navy-700 underline-offset-2 hover:underline">
            ← Department hub
          </Link>
        </p>
        <p className="text-xs font-semibold tracking-[0.22em] text-amber-500">HR</p>
        <h1 className="mt-1 font-display text-3xl text-navy-950">
          {current === "register" ? "201 File Register" : "Company constants"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {current === "register"
            ? "Personnel records filed surname-first. Search accepts either name order."
            : "Values used on issued documents. Do not hard-code these in screens."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm text-muted">{formatCalendarDate(manilaTodayYmd())}</p>
        <Link
          href="/app/hr"
          className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold ${
            current === "register"
              ? "bg-navy-900 text-white"
              : "border border-navy-200 bg-white text-navy-900"
          }`}
        >
          Register
        </Link>
        <Link
          href="/app/hr/settings"
          className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold ${
            current === "settings"
              ? "bg-navy-900 text-white"
              : "border border-navy-200 bg-white text-navy-900"
          }`}
        >
          Settings
        </Link>
      </div>
    </div>
  );
}

export function HrDenied() {
  return (
    <p className="rounded-md border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-800">
      This workspace is gated. Your account is assigned to another department. Ask an administrator
      if you need HR access.
    </p>
  );
}

export function DataWarning({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-navy-900">
      {message}
    </div>
  );
}
