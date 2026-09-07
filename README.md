# CorConDev Company Portal

Internal operations portal for **CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION** (Cebu City, Philippines). Office and site staff sign in, then open the department workspace they are assigned to.

This phase covers the company landing page, authentication, a gated department hub, department stubs, and the **HR 201 File Register** foundation (schema, search, company constants). Drive OAuth, printed forms, discipline, attendance, cash advances, recruitment, and AI drafting are not implemented yet.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS only (no animation libraries)
- `next/font` (Source Sans 3 + Source Serif 4)
- Supabase Auth via `@supabase/ssr`
- Calendar dates in **Asia/Manila** — never derived from `Date#toISOString`

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without Supabase environment variables the app runs in **DEMO MODE**: a prominent banner is shown and login creates a mock session so the UI can be reviewed. The 201 File Register uses a sample Filipino roster (including one unclassified `employment_status`). No passwords are stored in frontend code.

```bash
npm run test:search
```

## Environment variables

Copy `.env.example` to `.env.local` and add your project values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Use the **anon / public** key only in the Next.js app. Never put the service role key, database password, or user passwords in client code or committed files.

## Authentication and profiles

- Email/password through Supabase Auth
- Middleware protects `/app/**` and `/settings`
- `profiles` is keyed to `auth.users` (`id` FK) with `full_name`, `department`, and `role` (`staff` | `dept_lead` | `hr` | `admin`)
- Row Level Security: authenticated users can read their own profile; admins can manage all profiles
- **Admin role** sees every department tile. Other roles see only their assigned department
- If a user can sign in but has no `profiles` row, the hub explains that an administrator must provision the account

Apply both migrations in the Supabase SQL editor (or `supabase db push`):

1. `supabase/migrations/20260907000001_create_profiles.sql`
2. `supabase/migrations/20260907000002_hr_201_foundation.sql`

The HR migration creates `settings`, `projects`, `employees`, `document_series`, and `document_register`, with RLS: HR role, admin role, or HR-department profiles have full access to employee files; other authenticated users can read settings, projects, and series only.

### Seed accounts (dashboard only)

Create users in **Supabase Dashboard → Authentication → Users**. Set a strong password there. Then insert matching profile rows — replace the UUIDs with the IDs Supabase generated:

```sql
insert into public.profiles (id, full_name, department, role)
values
  ('00000000-0000-0000-0000-000000000001', 'Office Administrator', 'admin', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'HR Officer', 'hr', 'hr'),
  ('00000000-0000-0000-0000-000000000003', 'Site Staff', 'site', 'staff');
```

Do not commit real emails or passwords. The first admin profile must be inserted from the SQL editor (service role / dashboard) because RLS only lets existing admins manage profiles.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Company landing + Login CTA |
| `/login` | Email/password (or demo role/department picker) |
| `/app` | Department hub with gated tiles |
| `/app/hr` | 201 File Register |
| `/app/hr/settings` | Company constants, projects, document series |
| `/app/[department]` | Department stub (all departments except HR) |
| `/settings` | Signed-in profile |

Department stubs show “module coming soon” and reserve a **Department Assistant — soon** slot. HR’s checklist tab is the same kind of stub (`201 checklist — next`).

## 201 File Register

- Left: searchable employee list. Right: Profile, Employment, Statutory, Emergency, Notes, Checklist (stub)
- Names are stored **surname-first** (`Dela Cruz, Maria S.`). Search matches **either order**, plus emp no and position. Queries are word-tokenized; commas and periods are ignored
- `employment_status` is nullable and is never defaulted. Blank means unclassified
- Company constants (TIN, prefix `CCDTC`, signatories, warning-day values) live in Settings — not hard-coded in screens
- Document series are seeded with the paper formats already in the filing cabinet (`2026 - 03`, `NTE2026 - 17`, `C.M. 2026 - 13`, …)

## Demo mode

Shown automatically when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing. If Supabase is configured but the HR tables are missing, the Register falls back to the same sample roster.

1. Open `/login`
2. Choose role **HR** and department **HR** (or Admin)
3. Open **HR** → confirm search: `Maria Dela Cruz` finds `Dela Cruz, Maria S.`
4. Open emp **1604** — status is Unclassified

The mock session is an httpOnly cookie. It is for local/UI review only.

## Netlify

1. Import this repository in Netlify
2. Build command: `npm run build` (see `netlify.toml`)
3. Publish directory: `.next`
4. Node version: `20`
5. In **Site settings → Environment variables**, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. Redeploy after env vars change

`@netlify/plugin-nextjs` is declared in `netlify.toml` so the Next.js App Router runtime is used. If you skip env vars on Netlify, the deployed site stays in DEMO MODE.

## Out of scope (this phase)

- Full 201 checklist UX
- Printed forms / document issuing
- Discipline, attendance, cash advances, leave
- Drive OAuth and folder reconciliation
- Recruitment / exams
- Department Assistant chat (slot only)
