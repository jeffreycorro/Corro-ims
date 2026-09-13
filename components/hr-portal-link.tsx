"use client";

import type { MouseEvent, ReactNode } from "react";
import { hrPortalHandoffUrl } from "@/lib/hr-handoff";

export function HrPortalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      window.location.assign(hrPortalHandoffUrl(href, session?.access_token));
    } catch {
      window.location.assign(href);
    }
  }

  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
