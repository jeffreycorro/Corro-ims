# CorConDev Company Portal

Internal operations portal for **CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION** (Cebu City, Philippines). Office and site staff sign in, then open the department workspace they are assigned to.

This phase covers the company landing page, email/password authentication, a gated department hub, and stub department homes. HR 201 File, Drive, document numbering, and the Department Assistant are **not** implemented yet.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS only (no animation libraries)
- `next/font` (Source Sans 3 + Source Serif 4)
- Supabase Auth via `@supabase/ssr`
- Dates displayed in **Asia/Manila**

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without Supabase environment variables the app runs in **DEMO MODE**: a prominent banner is shown and login creates a mock session so the UI can be reviewed. No passwords are stored in frontend code.

## Environment variables

Copy `.env.example` to `.env.local` and add your project values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Use the **anon / public** key only in the Next.js app. Never put the service role key, database password, or user passwords in client code or committed files.

## Authentication and profiles

- Email/password through Supabase Auth
- Signed-in staff can change their own password from **Settings** (header link on `/app`, `/app/[department]`, and `/settings`). The form re-checks the current password, then calls `updateUser({ password })`. Demo mode explains that mock sessions cannot update a password.
- Middleware protects `/app/**` and `/settings`
- `profiles` is keyed to `auth.users` (`id` FK) with `full_name`, `department`, and `role` (`staff` | `dept_lead` | `hr` | `admin`)
- Row Level Security: authenticated users can read their own profile; admins can manage all profiles
- **Admin role** sees every department tile. Other roles see only their assigned department
- If a user can sign in but has no `profiles` row, the hub explains that an administrator must provision the account

Apply the schema from `supabase/migrations/20260907000001_create_profiles.sql` in the Supabase SQL editor (or `supabase db push`).

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
| `/app/[department]` | Department stub (`admin`, `technical`, `finance`, `procurement`, `motorpool`, `safety`, `site`, `hr`) |
| `/settings` | Signed-in profile and change-password form |

Department stubs show “module coming soon”. HR also notes **201 File Register — next**. Each stub reserves a **Department Assistant — soon** slot.

## Demo mode

Shown automatically when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing.

1. Open `/login`
2. Choose a role and department
3. Enter the portal and confirm hub gating (admin sees all tiles; staff see only theirs)

The mock session is an httpOnly cookie. It is for local/UI review only.

## Netlify

1. Import this repository in Netlify
2. Build command: `npm run build` (see `netlify.toml`)
3. Publish directory: `.next`
4. Node version: `20`
5. In **Site settings → Environment variables**, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. Redeploy after env vars change

`@netlify/plugin-nextjs` is declared in `netlify.toml` so the Next.js App Router runtime is used. If you skip env vars on Netlify, the deployed site stays in DEMO MODE.

## HR artifact (separate Netlify site)

The Claude HR single-file app is **not** part of this portal build. Host it from [`hr-artifact/`](hr-artifact/) as its **own** Netlify site (base directory `hr-artifact`). Do not point the company portal at that folder. See `hr-artifact/README.md` for paste-the-export, shim injection, SQL, env, and privacy steps.

## Out of scope (this phase)

- Full HR 201 File Register (the artifact host in `hr-artifact/` is a separate deploy)
- Drive / document storage
- Document numbering
- Department Assistant chat (slot only)
