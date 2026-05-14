import type { LongTermPlan, PlanCalendarEntry, SessionReport, TrainingReschedule } from "@/lib/types";

export const trainingRescheduleErrorMessages = {
  sourceMustBeTrainingDay: "只能调整训练日，休息日不能顺延。",
  targetMustBeAfterSource: "目标日期必须晚于原训练日。",
  sourceAlreadyCompleted: "这个训练日已经完成，不能再调整。",
  targetAlreadyHasReport: "目标日期已经有训练记录，不能再插入新的训练日。",
  sourceAlreadyRescheduled: "这个训练日已经被调整过了。",
  targetAlreadyReceivesTraining: "目标日期已经承接了别的训练日。",
  updateNotFound: "没有找到要修改的训练改期记录。",
  targetCannotEqualSource: "目标日期不能和原日期相同。",
  completedRescheduleCannotUpdate: "这条改期对应的训练已经完成，不能再修改。",
  linkedReportCannotUpdate: "这条改期已经关联训练记录，不能再修改。",
  targetAlreadyHasReportForUpdate: "目标日期已经有训练记录，不能再改到这里。",
  deleteNotFound: "没有找到要取消的训练改期记录。",
  completedRescheduleCannotDelete: "这条改期对应的训练已经完成，不能取消。",
  linkedReportCannotDelete: "这条改期已经关联训练记录，不能取消。",
} as const;

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
