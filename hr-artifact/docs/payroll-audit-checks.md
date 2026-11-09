# Payroll review checks

The payroll run shows a review list. It does not change hours, deductions, OT requests, or finalize. Marking a row Reviewed stores a note on that pay run. Recomputing days and overtime leaves the note in place.

Each row’s key is `checkId|empId|date`. The same person and day keep the same note after a recompute.

## How to add a check

In `public/index.html`, add one object to the array returned by `payAuditChecks`:

- `id` — stable short name, used in the item key.
- `description` — one sentence HR can read.
- `severity` — `info` or `review`.
- `run(ctx)` — returns `{ empId, empNo, name, date, details }` rows. `ctx.from` and `ctx.to` are the period. Read `S.daily`, `S.otreqs`, and `S.employees`. Do not write them, and do not write the pay run except through Reviewed.

Wire-up, the on-screen list, and the Reviewed note already call `payAuditRun`. A new check does not need a new screen.

## Checks in this build

1. `ot_paid_no_request` (review) — overtime is paid for the day, from a typed Daily Manpower OT number or from the time out, and no open OT request covers that person. Rejected and cancelled requests do not count as a cover.
2. `ot_request_no_daily` (review) — description: “Request filed, OT not shown in time records.” A filed or approved request (not rejected or cancelled) and the day’s payable OT is 0. Payable OT is the typed number when it is above 0, otherwise the clock. An overnight request (for example 18:00–03:00) is that start date only.
3. `ot_manual_differs_clock` (info) — the typed Daily Manpower OT number is above 0 and is not the clock figure. Payroll still pays the typed number.

## Clock overtime

Payroll hours for a day:

- Typed `daily.rows[emp].ot` above 0 wins.
- Otherwise the hours are time out past schedule end. Monday–Friday end at 5:00 PM. Saturday ends at 12:00 noon. Sunday has no clock OT unless the 201 file has `scheduleEnd` (or `schedOut`).
- `otHoursFromClock` measures the span, so a time out earlier than the start (18:00–03:00) stays on the start date and is rounded to a hundredth of an hour.
- The unpaid meal is 12:00–13:00 and is removed only when that hour sits inside the overtime window.
- Under 0.5 hour is not overtime.

An OT request is not an input to the hours. `otFormGateWaived` still decides whether those hours are paid when the gate is turned off. The default remains waived.

## Planned, not built

- Blank time in or time out on Present days.
- Late after 8:15 charged at ₱1 per minute from 8:00.
- Government contributions for anyone under 3 months, or with KASABUTAN on file.
- A cash advance with no matching CAF.
- A recurring deduction whose balance is already zero.
