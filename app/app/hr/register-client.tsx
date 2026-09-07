"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatCalendarDate } from "@/lib/dates";
import { formatPhp } from "@/lib/hr/money";
import { employeeMatchesQuery, givenNameFirst } from "@/lib/hr/search";
import {
  employeeDepartmentLabel,
  employmentStatusLabel,
  type Employee,
  type EmploymentStatus,
} from "@/lib/hr/types";

const TABS = ["Profile", "Employment", "Statutory", "Emergency", "Notes", "Checklist"] as const;
type Tab = (typeof TABS)[number];

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function initials(name: string): string {
  const comma = name.indexOf(",");
  const surname = (comma === -1 ? name : name.slice(0, comma)).trim();
  const rest = comma === -1 ? "" : name.slice(comma + 1).trim();
  const a = surname.charAt(0);
  const b = rest.charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

function StatusBadge({ status }: { status: EmploymentStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex rounded border border-dashed border-amber-500 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        Unclassified
      </span>
    );
  }

  const tone =
    status === "Separated"
      ? "bg-navy-100 text-navy-700"
      : status === "Probationary"
        ? "bg-amber-50 text-amber-700 ring-1 ring-amber-300"
        : status === "Project-based"
          ? "bg-navy-900 text-amber-300"
          : "bg-navy-100 text-navy-900";

  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {status}
    </span>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-navy-100 px-4 py-2.5 sm:grid-cols-[11rem_1fr] sm:items-baseline">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600">{label}</dt>
      <dd className="text-sm text-navy-950">{value ?? "—"}</dd>
    </div>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-navy-100">{children}</dl>;
}

export function HrRegister({
  employees,
  initialEmpNo,
}: {
  employees: Employee[];
  initialEmpNo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("Profile");

  const filtered = useMemo(
    () => employees.filter((employee) => employeeMatchesQuery(employee, query)),
    [employees, query],
  );

  const selectedEmpNo = searchParams.get("emp") ?? initialEmpNo ?? null;

  const selected =
    (selectedEmpNo ? filtered.find((employee) => employee.emp_no === selectedEmpNo) : undefined) ??
    filtered[0] ??
    null;

  function selectEmployee(empNo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("emp", empNo);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setTab("Profile");
  }

  return (
    <div className="grid min-h-[36rem] overflow-hidden rounded-xl border border-navy-100 bg-white shadow-sm lg:grid-cols-[20.5rem_1fr]">
      <aside className="flex min-h-[18rem] flex-col border-b border-navy-100 lg:border-b-0 lg:border-r">
        <div className="border-b border-navy-100 p-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-600">
              Search
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, emp no, position"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-navy-200 bg-white px-3 text-sm text-navy-900 outline-none ring-amber-400 focus:ring-2"
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            {filtered.length} of {employees.length}
            {query.trim() ? " match" : " on file"}
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">No records match that search.</li>
          ) : (
            filtered.map((employee) => {
              const active = selected?.id === employee.id;
              return (
                <li key={employee.id}>
                  <button
                    type="button"
                    onClick={() => selectEmployee(employee.emp_no)}
                    className={`flex w-full flex-col items-start gap-1 border-b border-navy-50 px-4 py-3 text-left ${
                      active ? "border-l-4 border-l-amber-400 bg-amber-50" : "border-l-4 border-l-transparent hover:bg-navy-50"
                    }`}
                  >
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-navy-600">{employee.emp_no}</span>
                      <StatusBadge status={employee.employment_status} />
                    </span>
                    <span className="text-sm font-semibold text-navy-950">{employee.name}</span>
                    <span className="text-xs text-muted">{dash(employee.position)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <section className="min-w-0">
        {!selected ? (
          <div className="flex h-full items-center justify-center px-6 py-16 text-sm text-muted">
            Select an employee.
          </div>
        ) : (
          <EmployeeDetail employee={selected} tab={tab} onTab={setTab} />
        )}
      </section>
    </div>
  );
}

function EmployeeDetail({
  employee,
  tab,
  onTab,
}: {
  employee: Employee;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-4 border-b border-navy-100 px-5 py-4">
        {employee.photo_link ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={employee.photo_link}
            alt=""
            className="h-14 w-14 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-navy-900 font-semibold text-amber-300">
            {initials(employee.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl text-navy-950">{employee.name}</h2>
            <StatusBadge status={employee.employment_status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">{givenNameFirst(employee.name)}</p>
          <p className="mt-1 text-sm text-navy-800">
            <span className="font-mono">{employee.emp_no}</span>
            <span className="text-muted"> · </span>
            {employeeDepartmentLabel(employee.department)}
            <span className="text-muted"> · </span>
            {dash(employee.position)}
          </p>
        </div>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-navy-100 px-3">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onTab(item)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold ${
              tab === item
                ? "border-amber-500 text-navy-950"
                : "border-transparent text-navy-600 hover:text-navy-900"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {tab === "Profile" ? <ProfileTab employee={employee} /> : null}
        {tab === "Employment" ? <EmploymentTab employee={employee} /> : null}
        {tab === "Statutory" ? <StatutoryTab employee={employee} /> : null}
        {tab === "Emergency" ? <EmergencyTab employee={employee} /> : null}
        {tab === "Notes" ? <NotesTab employee={employee} /> : null}
        {tab === "Checklist" ? <ChecklistStub /> : null}
      </div>
    </div>
  );
}

function ProfileTab({ employee }: { employee: Employee }) {
  return (
    <Fields>
      <Field label="Emp no" value={<span className="font-mono">{employee.emp_no}</span>} />
      <Field label="Name (filed)" value={employee.name} />
      <Field label="Given-name first" value={givenNameFirst(employee.name)} />
      <Field label="Nickname" value={dash(employee.nickname)} />
      <Field label="Birthdate" value={formatCalendarDate(employee.birthdate)} />
      <Field label="Sex" value={dash(employee.sex)} />
      <Field label="Civil status" value={dash(employee.civil_status)} />
      <Field label="Address" value={dash(employee.address)} />
      <Field label="Mobile" value={dash(employee.mobile)} />
      <Field label="Email" value={dash(employee.email)} />
      <Field label="Department" value={employeeDepartmentLabel(employee.department)} />
      <Field label="Position" value={dash(employee.position)} />
    </Fields>
  );
}

function EmploymentTab({ employee }: { employee: Employee }) {
  return (
    <Fields>
      <Field label="Status" value={employmentStatusLabel(employee.employment_status)} />
      <Field label="Status basis" value={dash(employee.status_basis)} />
      <Field label="Date hired" value={formatCalendarDate(employee.date_hired)} />
      <Field label="Contract start" value={formatCalendarDate(employee.contract_start)} />
      <Field label="Contract end" value={formatCalendarDate(employee.contract_end)} />
      <Field label="Prior contract no" value={dash(employee.prior_contract_no)} />
      <Field label="Regularized on" value={formatCalendarDate(employee.regularized_on)} />
      <Field label="Project" value={dash(employee.project)} />
      <Field label="Place of assignment" value={dash(employee.project_location)} />
      <Field label="Supervisor" value={dash(employee.supervisor)} />
      <Field label="Rate type" value={dash(employee.rate_type)} />
      <Field label="Daily rate" value={formatPhp(employee.daily_rate)} />
      <Field label="Allowance" value={formatPhp(employee.allowance)} />
      <Field label="Roster confirmed" value={formatCalendarDate(employee.roster_confirmed)} />
      <Field label="Separated on" value={formatCalendarDate(employee.separated_on)} />
      <Field label="Separation reason" value={dash(employee.separation_reason)} />
    </Fields>
  );
}

function StatutoryTab({ employee }: { employee: Employee }) {
  return (
    <Fields>
      <Field label="SSS" value={<span className="font-mono">{dash(employee.sss_no)}</span>} />
      <Field label="TIN" value={<span className="font-mono">{dash(employee.tin_no)}</span>} />
      <Field label="PhilHealth" value={<span className="font-mono">{dash(employee.philhealth_no)}</span>} />
      <Field label="Pag-IBIG" value={<span className="font-mono">{dash(employee.pagibig_no)}</span>} />
      <Field label="Bank account" value={dash(employee.bank_account)} />
    </Fields>
  );
}

function EmergencyTab({ employee }: { employee: Employee }) {
  return (
    <Fields>
      <Field label="Contact" value={dash(employee.emergency_name)} />
      <Field label="Relation" value={dash(employee.emergency_relation)} />
      <Field label="Number" value={dash(employee.emergency_number)} />
    </Fields>
  );
}

function NotesTab({ employee }: { employee: Employee }) {
  return (
    <Fields>
      <Field label="Notes" value={dash(employee.notes)} />
      <Field
        label="Drive folder"
        value={
          employee.drive_folder_link ? (
            <a href={employee.drive_folder_link} className="text-navy-700 underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
              {employee.drive_folder_id ?? employee.drive_folder_link}
            </a>
          ) : (
            dash(employee.drive_folder_id)
          )
        }
      />
      <Field label="Photo link" value={dash(employee.photo_link)} />
    </Fields>
  );
}

function ChecklistStub() {
  return (
    <div className="m-4 rounded-lg border border-dashed border-navy-200 bg-navy-50 px-5 py-6">
      <p className="text-xs font-semibold tracking-[0.18em] text-navy-600">MODULE</p>
      <h3 className="mt-2 font-display text-2xl text-navy-950">201 checklist — next</h3>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Document types, completeness, expiry, and Drive file chips are out of scope for this
        foundation. The <code className="font-semibold">checklist</code> JSON column is already on
        the employee row.
      </p>
    </div>
  );
}
