import { HomeDashboard } from "@/components/home-dashboard";
import { buildPlanSnapshots } from "@/lib/plan-generator";
import { buildDailyBriefFromSnapshot, buildTodayAutofillBrief } from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import { isoToday } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();
  const today = isoToday();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedDateParam = resolvedSearchParams?.date;
  const selectedDate = Array.isArray(selectedDateParam) ? selectedDateParam[0] : selectedDateParam;
  const activeDate = selectedDate ?? today;
  const isHistorical = activeDate !== today;

  let historySnapshot = isHistorical ? await repository.findPlanSnapshotByDate(activeDate) : null;
  if (isHistorical && !historySnapshot) {
    historySnapshot = buildPlanSnapshots({
      profile: snapshot.profile,
      persona: snapshot.persona,
      plan: snapshot.plan,
      templates: snapshot.templates,
    }).find((item) => item.date === activeDate) ?? null;
  }

  const todayBrief =
    historySnapshot && isHistorical
      ? buildDailyBriefFromSnapshot(historySnapshot)
      : buildTodayAutofillBrief(
          activeDate,
          snapshot.profile,
          snapshot.plan,
          snapshot.templates,
          snapshot.recentReports,
        );

  return (
    <HomeDashboard
      snapshot={snapshot}
      today={activeDate}
      todayBrief={todayBrief}
      isHistorical={isHistorical}
      historyMissingSnapshot={Boolean(isHistorical && !historySnapshot)}
    />
  );
}
