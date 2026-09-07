import { formatManilaDateTime } from "@/lib/dates";

export function SiteFooter() {
  return (
    <footer className="border-t border-navy-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>Corro Construction Development and Trade Corporation · Cebu City, Philippines</p>
        <p>Asia/Manila · {formatManilaDateTime()}</p>
      </div>
    </footer>
  );
}
