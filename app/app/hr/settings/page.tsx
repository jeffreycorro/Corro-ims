import { DataWarning, HrDenied, HrNav } from "@/app/app/hr/hr-chrome";
import { HrSettingsForm } from "@/app/app/hr/settings-form";
import { requireUser } from "@/lib/auth";
import { manilaTodayYmd } from "@/lib/dates";
import { canAccessHr } from "@/lib/hr/access";
import { loadHrFoundation } from "@/lib/hr/load";
import { seriesExample } from "@/lib/hr/series";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "HR settings",
};

export default async function HrSettingsPage() {
  const user = await requireUser();
  const data = await loadHrFoundation();
  const allowed = canAccessHr(user);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <HrNav current="settings" />
      {!allowed ? (
        <HrDenied />
      ) : (
        <>
          <DataWarning message={data.warning} />
          <HrSettingsForm settings={data.settings} demo={data.source === "demo"} />

          <section className="mt-10 rounded-xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-xl text-navy-950">Projects</h2>
            <p className="mt-1 text-sm text-muted">
              Single source of truth for project names. Closed sites stay on the list.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="border-b border-navy-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Location</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((project) => (
                    <tr key={project.id} className="border-b border-navy-50">
                      <td className="py-2 pr-4 font-medium text-navy-950">{project.name}</td>
                      <td className="py-2 pr-4 text-navy-800">{project.location ?? "—"}</td>
                      <td className="py-2">{project.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-xl text-navy-950">Document series</h2>
            <p className="mt-1 text-sm text-muted">
              Printed formats match paper already in the cabinet. Spacing and padding are deliberate.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-navy-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600">
                  <tr>
                    <th className="py-2 pr-3">Key</th>
                    <th className="py-2 pr-3">Document</th>
                    <th className="py-2 pr-3">Prefix</th>
                    <th className="py-2 pr-3">Pad</th>
                    <th className="py-2 pr-3">Pattern</th>
                    <th className="py-2">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((series) => (
                    <tr key={series.key} className="border-b border-navy-50">
                      <td className="py-2 pr-3 font-mono font-semibold">{series.key}</td>
                      <td className="py-2 pr-3">{series.label}</td>
                      <td className="py-2 pr-3 font-mono text-navy-700">
                        {series.prefix === "" ? "—" : series.prefix}
                      </td>
                      <td className="py-2 pr-3 font-mono">{series.padding}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{series.pattern}</td>
                      <td className="py-2 font-mono text-xs">
                        {seriesExample(series, Number(manilaTodayYmd().slice(0, 4)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
