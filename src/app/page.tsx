import { HomeDashboard } from "@/components/home-dashboard";
import { buildPlanSnapshots } from "@/lib/plan-generator";
import {
  buildDailyBriefFromSnapshot,
  buildRescheduledOutBrief,
  buildTodayAutofillBrief,
  rebaseDailyBriefToDate,
} from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import { findInboundReschedule, findOutboundReschedule, findReportForDate } from "@/lib/training-reschedule";
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
  const reportHistory = await repository.listSessionReports(Math.max(snapshot.plan.calendarEntries.length + 14, 90));
  const trainingReschedules = await repository.listTrainingReschedules();
  const today = isoToday();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedDateParam = resolvedSearchParams?.date;
  const selectedDate = Array.isArray(selectedDateParam) ? selectedDateParam[0] : selectedDateParam;
  const activeDate = selectedDate ?? today;
  const isHistorical = activeDate !== today;
  const inboundReschedule = findInboundReschedule(trainingReschedules, activeDate);
  const outboundReschedule = findOutboundReschedule(trainingReschedules, activeDate);
  const existingReport = findReportForDate(reportHistory, activeDate);

  let historySnapshot = isHistorical ? await repository.findPlanSnapshotByDate(activeDate) : null;
  if (isHistorical && !historySnapshot) {
    historySnapshot = buildPlanSnapshots({
      profile: snapshot.profile,
      persona: snapshot.persona,
      plan: snapshot.plan,
      templates: snapshot.templates,
    }).find((item) => item.date === activeDate) ?? null;
  }

  let todayBrief;
  if (inboundReschedule) {
    const sourceSnapshot =
      (await repository.findPlanSnapshotByDate(inboundReschedule.sourceDate)) ??
      buildPlanSnapshots({
        profile: snapshot.profile,
        persona: snapshot.persona,
        plan: snapshot.plan,
        templates: snapshot.templates,
      }).find((item) => item.date === inboundReschedule.sourceDate) ??
      null;
    const sourceBrief = sourceSnapshot
      ? buildDailyBriefFromSnapshot(sourceSnapshot)
      : buildTodayAutofillBrief(
          inboundReschedule.sourceDate,
          snapshot.profile,
          snapshot.plan,
          snapshot.templates,
          reportHistory,
        );
    todayBrief = rebaseDailyBriefToDate(sourceBrief, activeDate, inboundReschedule);
  } else if (outboundReschedule && !existingReport) {
    todayBrief = buildRescheduledOutBrief({
      date: activeDate,
      targetDate: outboundReschedule.targetDate,
      profile: snapshot.profile,
      plan: snapshot.plan,
    });
  } else {
    todayBrief =
      historySnapshot && isHistorical
        ? buildDailyBriefFromSnapshot(historySnapshot)
        : buildTodayAutofillBrief(
            activeDate,
            snapshot.profile,
            snapshot.plan,
            snapshot.templates,
            reportHistory,
          );
  }

  return (
    <HomeDashboard
      snapshot={snapshot}
      today={activeDate}
      currentDate={today}
      todayBrief={todayBrief}
      reportHistory={reportHistory}
      trainingReschedules={trainingReschedules}
      isHistorical={isHistorical}
      historyMissingSnapshot={Boolean(isHistorical && !historySnapshot)}
    />
  );
}
