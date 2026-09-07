import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col bg-navy-50">
      <SiteHeader user={user} variant="portal" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
