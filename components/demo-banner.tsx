import { isDemoMode } from "@/lib/env";

export function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div className="border-b border-amber-300/40 bg-amber-400 text-navy-950">
      <p className="mx-auto max-w-6xl px-5 py-2 text-center text-sm font-semibold tracking-wide">
        DEMO MODE — Supabase is not configured. A mock session is used so the portal can be
        reviewed. No passwords are stored in the client.
      </p>
    </div>
  );
}
