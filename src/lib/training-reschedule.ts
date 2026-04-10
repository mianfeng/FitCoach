import type { LongTermPlan, PlanCalendarEntry, SessionReport, TrainingReschedule } from "@/lib/types";

export function getScheduledDate(report: Pick<SessionReport, "date" | "scheduledDate">) {
  return report.scheduledDate ?? report.date;
}

export function findReportForDate(reports: SessionReport[], date: string) {
  return (
    reports.find((report) => report.date === date) ??
    reports.find((report) => getScheduledDate(report) === date) ??
    null
  );
}

export function getCompletedScheduledDateSet(reports: SessionReport[]) {
  return new Set(reports.filter((report) => report.completed).map((report) => getScheduledDate(report)));
}

export function findInboundReschedule(reschedules: TrainingReschedule[], date: string) {
  return reschedules.find((item) => item.targetDate === date) ?? null;
}

export function findOutboundReschedule(reschedules: TrainingReschedule[], date: string) {
  return reschedules.find((item) => item.sourceDate === date) ?? null;
}

export function listMissedTrainingEntries(params: {
  plan: LongTermPlan;
  reports: SessionReport[];
  reschedules: TrainingReschedule[];
  today: string;
}) {
  const { plan, reports, reschedules, today } = params;
  const completedScheduledDates = getCompletedScheduledDateSet(reports);
  const activeSourceDates = new Set(reschedules.map((item) => item.sourceDate));

  return plan.calendarEntries.filter((entry) => {
    if (entry.date >= today || entry.slot === "rest") {
      return false;
    }

    if (completedScheduledDates.has(entry.date)) {
      return false;
    }

    if (activeSourceDates.has(entry.date)) {
      return false;
    }

    return true;
  });
}

export function resolveCalendarEntry(plan: LongTermPlan, date: string) {
  return plan.calendarEntries.find((entry) => entry.date === date) ?? null;
}

export function getCalendarLabel(entry: PlanCalendarEntry) {
  return `${entry.label}${entry.slot === "rest" ? "" : ` · ${entry.slot} 日`}`;
}
