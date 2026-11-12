# Payroll review checks

The payroll run shows a review list. It does not change hours, deductions, OT requests, or finalize. Marking a row Reviewed stores a note on that pay run. Recomputing days and overtime leaves the note in place.

Each row’s key is `checkId|empId|date`. The same person and day keep the same note after a recompute.

## How to add a check

In `public/index.html`, add one object to the array returned by `payAuditChecks`:

- `id` — stable short name, used in the item key.
- `description` — one sentence HR can read.
- `severity` — `info` or `review`.
- `run(ctx)` — returns `{ empId, empNo, name, date, details }` rows. `ctx.from` and `ctx.to` are the period. Read `S.daily`, `S.otplans`, `S.otreps`, and `S.employees`. Do not read `S.otreqs` for pay or for these checks. Do not write the stores, and do not write the pay run except through Reviewed.

Wire-up, the on-screen list, and the Reviewed note already call `payAuditRun`. A new check does not need a new screen.

## Checks in this build

Old OT requests are not read. `ot_paid_no_request` and `ot_request_no_daily` are not in the registry. The Afternoon Plan and Morning Report checks below replace them. A check still does not change hours, deductions, or finalize.

1. `ot_manual_differs_clock` (info) — the typed Daily Manpower OT number is above 0 and is not the clock figure. Payroll still pays the typed number.
2. `ot_dm_differs_report` (review) — Daily Manpower OT is not the hours confirmed on the Morning Report. Payroll pays the Daily Manpower number.
3. `ot_plan_no_report` (review) — an Afternoon Plan names a person who has no Morning Report. This is “Report missing.” A Morning Report that records No OT is not missing.
4. `ot_report_no_plan` (review) — a Morning Report was filed with no Afternoon Plan.
5. `ot_hours_after_no_ot` (review) — Daily Manpower OT is above 0 for a person the Morning Report marked No OT.
6. `ot_dm_no_plan_or_report` (review) — Daily Manpower OT is above 0 and that person has no Afternoon Plan and no Morning Report.
7. `ot_employee_not_roster` (review) — a name on a plan or report is not on the roster.
8. `ot_rest_day_premium` (review) — Sunday or holiday overtime, and the day’s premium is still As is. The check does not grant the premium.
9. `ot_plan_cancelled` (info) — “Plan cancelled (reason).” The Morning Report recorded No OT with Weather, Materials/Equipment, or Other. This is separate from Report missing.
10. `ot_not_in_plan` (review) — a Morning Report linked to a plan includes someone who was not on that plan. Pay is not blocked.

Planned hours never count as reported OT. Only Morning Report rows that are not No OT do. The payroll approval screen shows a warning, and does not block approval, when a day in the period has plan or report overtime and Daily Manpower OT for that day is zero.

## Clock overtime

Payroll hours for a day:

- Typed `daily.rows[emp].ot` above 0 wins.
- Otherwise the hours are time out past schedule end. Monday–Friday end at 5:00 PM. Saturday ends at 12:00 noon. Sunday has no clock OT unless the 201 file has `scheduleEnd` (or `schedOut`).
- `otHoursFromClock` measures the span, so a time out earlier than the start (18:00–03:00) stays on the start date and is rounded to a hundredth of an hour.
- The unpaid meal is 12:00–13:00 and is removed only when that hour sits inside the overtime window.
- Under 0.5 hour is not overtime.

An old OT request is not an input to the hours. `otFormGateWaived` still decides whether those hours are paid when the gate is turned off. When the gate is on, a Morning Report that confirms the hours is what unlocks pay. The default remains waived, so Daily Manpower OT is paid and the new checks only flag.

## Planned, not built

- Blank time in or time out on Present days.
- Late after 8:15 charged at ₱1 per minute from 8:00.
- Government contributions for anyone under 3 months, or with KASABUTAN on file.
- A cash advance with no matching CAF.
- A recurring deduction whose balance is already zero.
