import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";

export function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) {
    throw new Error("Supabase is not configured.");
  }

  return createBrowserClient(env.url, env.anonKey);
}
