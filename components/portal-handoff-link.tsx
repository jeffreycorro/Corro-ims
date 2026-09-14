"use client";

import type { MouseEvent, ReactNode } from "react";
import { portalHandoffUrl } from "@/lib/portal-handoff";

export function PortalHandoffLink({
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
      window.location.assign(portalHandoffUrl(href, session?.access_token));
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
