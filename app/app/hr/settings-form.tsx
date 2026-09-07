"use client";

import { SubmitButton } from "@/components/submit-button";
import { saveHrSettingsAction } from "@/app/app/hr/actions";
import type { CompanySettings } from "@/lib/hr/types";

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  step,
  required,
}: {
  name: string;
  label: string;
  defaultValue: string | number | null;
  type?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-navy-900">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        required={required}
        defaultValue={defaultValue ?? ""}
        className="h-11 w-full rounded-md border border-navy-200 bg-white px-3 text-navy-900 outline-none ring-amber-400 focus:ring-2"
      />
    </label>
  );
}

export function HrSettingsForm({
  settings,
  demo,
}: {
  settings: CompanySettings;
  demo: boolean;
}) {
  return (
    <form action={saveHrSettingsAction} className="space-y-8">
      <section className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-xl text-navy-950">Company</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field name="company_name" label="Company name" defaultValue={settings.company_name} required />
          </div>
          <div className="sm:col-span-2">
            <Field name="address" label="Address" defaultValue={settings.address} required />
          </div>
          <Field name="tin" label="TIN" defaultValue={settings.tin} />
          <Field name="document_prefix" label="Document prefix" defaultValue={settings.document_prefix} required />
        </div>
      </section>

      <section className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-xl text-navy-950">Signatories</h2>
        <p className="mt-1 text-sm text-muted">Name + title pairs. Blank names must not print as empty lines later.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field name="hr_officer_name" label="HR officer — name" defaultValue={settings.hr_officer_name} />
          <Field name="hr_officer_title" label="HR officer — title" defaultValue={settings.hr_officer_title} />
          <Field name="admin_head_name" label="Administrative head — name" defaultValue={settings.admin_head_name} />
          <Field name="admin_head_title" label="Administrative head — title" defaultValue={settings.admin_head_title} />
          <Field name="finance_officer_name" label="Finance officer — name" defaultValue={settings.finance_officer_name} />
          <Field name="finance_officer_title" label="Finance officer — title" defaultValue={settings.finance_officer_title} />
          <Field name="ceo_name" label="CEO / President — name" defaultValue={settings.ceo_name} />
          <Field name="ceo_title" label="CEO / President — title" defaultValue={settings.ceo_title} />
        </div>
      </section>

      <section className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-xl text-navy-950">Warning and period constants</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="probation_warning_days" label="Probation warning (days)" type="number" defaultValue={settings.probation_warning_days} />
          <Field name="contract_end_warning_days" label="Contract-end warning (days)" type="number" defaultValue={settings.contract_end_warning_days} />
          <Field name="document_expiry_warning_days" label="Document-expiry warning (days)" type="number" defaultValue={settings.document_expiry_warning_days} />
          <Field name="nte_answer_days" label="Days to answer an NTE" type="number" defaultValue={settings.nte_answer_days} />
          <Field name="discipline_lookback_months" label="Discipline lookback (months)" type="number" defaultValue={settings.discipline_lookback_months} />
          <Field name="cash_advance_liquidate_days" label="Days to liquidate a CA" type="number" defaultValue={settings.cash_advance_liquidate_days} />
          <Field name="workdays_per_period" label="Workdays per period" type="number" defaultValue={settings.workdays_per_period} />
          <Field name="overtime_multiplier" label="Overtime multiplier" type="number" step="0.01" defaultValue={settings.overtime_multiplier} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel="Saving…"
          className="inline-flex h-11 items-center rounded-md bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
        >
          Save constants
        </SubmitButton>
        {demo ? (
          <p className="text-sm text-muted">Demo mode stores these in a session cookie only.</p>
        ) : null}
      </div>
    </form>
  );
}
