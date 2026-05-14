import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { materializePlanCalendar } from "@/lib/plan-calendar";
import { buildPlanSnapshots } from "@/lib/plan-generator";
import { buildTodayAutofillBrief } from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import {
  findReportForDate,
  getCompletedScheduledDateSet,
  trainingRescheduleErrorMessages,
} from "@/lib/training-reschedule";
import { uid } from "@/lib/utils";
import {
  trainingRescheduleDeleteSchema,
  trainingRescheduleSchema,
  trainingRescheduleUpdateSchema,
} from "@/lib/validations";

async function loadRescheduleContext() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();
  const reports = await repository.listSessionReports(Math.max(snapshot.plan.calendarEntries.length + 14, 90));
  const reschedules = await repository.listTrainingReschedules();

  return {
    repository,
    snapshot,
    reports,
    reschedules,
    completedScheduledDates: getCompletedScheduledDateSet(reports),
  };
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/history");
}

async function persistRescheduledPlan(
  context: Awaited<ReturnType<typeof loadRescheduleContext>>,
  nextReschedules: Awaited<ReturnType<typeof loadRescheduleContext>>["reschedules"],
) {
  const nextPlanSetup = {
    profile: context.snapshot.profile,
    persona: context.snapshot.persona,
    plan: {
      ...context.snapshot.plan,
      calendarEntries: materializePlanCalendar(context.snapshot.plan.baseCalendarEntries, nextReschedules),
    },
    templates: context.snapshot.templates,
  };
  const savedPlanSetup = await context.repository.savePlanSetup(nextPlanSetup, {
    preserveTrainingReschedules: true,
  });
  await context.repository.replacePlanSnapshots(buildPlanSnapshots(savedPlanSetup));
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = trainingRescheduleSchema.parse(payload);
    const context = await loadRescheduleContext();
    const { repository, snapshot, reports, reschedules, completedScheduledDates } = context;
    const sourceBrief = buildTodayAutofillBrief(
      parsed.sourceDate,
      snapshot.profile,
      snapshot.plan,
      snapshot.templates,
      reports,
    );

    if (sourceBrief.calendarSlot === "rest") {
      throw new Error(trainingRescheduleErrorMessages.sourceMustBeTrainingDay);
    }
    if (parsed.targetDate <= parsed.sourceDate) {
      throw new Error(trainingRescheduleErrorMessages.targetMustBeAfterSource);
    }
    if (completedScheduledDates.has(parsed.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.sourceAlreadyCompleted);
    }
    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error(trainingRescheduleErrorMessages.targetAlreadyHasReport);
    }
    if (reschedules.some((item) => item.sourceDate === parsed.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.sourceAlreadyRescheduled);
    }
    if (reschedules.some((item) => item.targetDate === parsed.targetDate)) {
      throw new Error(trainingRescheduleErrorMessages.targetAlreadyReceivesTraining);
    }

    const reschedule = {
      id: uid("reschedule"),
      sourceDate: parsed.sourceDate,
      targetDate: parsed.targetDate,
      sourceDay: sourceBrief.calendarSlot,
      sourceLabel: sourceBrief.calendarLabel,
      action: "postpone" as const,
      note: parsed.note,
      createdAt: new Date().toISOString(),
    };

    const saved = await repository.saveTrainingReschedule(reschedule);
    await persistRescheduledPlan(
      context,
      [...reschedules, saved].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
    revalidateAll();
    return NextResponse.json({ reschedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reschedule training";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    const parsed = trainingRescheduleUpdateSchema.parse(payload);
    const context = await loadRescheduleContext();
    const { repository, reports, reschedules, completedScheduledDates } = context;
    const existing = reschedules.find((item) => item.id === parsed.id);

    if (!existing) {
      throw new Error(trainingRescheduleErrorMessages.updateNotFound);
    }
    if (parsed.targetDate <= existing.sourceDate) {
      throw new Error(trainingRescheduleErrorMessages.targetMustBeAfterSource);
    }
    if (existing.sourceDate === parsed.targetDate) {
      throw new Error(trainingRescheduleErrorMessages.targetCannotEqualSource);
    }
    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.completedRescheduleCannotUpdate);
    }
    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.linkedReportCannotUpdate);
    }
    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error(trainingRescheduleErrorMessages.targetAlreadyHasReportForUpdate);
    }
    if (reschedules.some((item) => item.id !== existing.id && item.targetDate === parsed.targetDate)) {
      throw new Error(trainingRescheduleErrorMessages.targetAlreadyReceivesTraining);
    }

    const updated = {
      ...existing,
      targetDate: parsed.targetDate,
      note: parsed.note ?? existing.note,
      action: "postpone" as const,
    };

    const saved = await repository.saveTrainingReschedule(updated);
    await persistRescheduledPlan(
      context,
      [...reschedules.filter((item) => item.id !== existing.id), saved].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      ),
    );
    revalidateAll();
    return NextResponse.json({ reschedule: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update training reschedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json();
    const parsed = trainingRescheduleDeleteSchema.parse(payload);
    const context = await loadRescheduleContext();
    const { repository, reports, reschedules, completedScheduledDates } = context;
    const existing = reschedules.find((item) => item.id === parsed.id);

    if (!existing) {
      throw new Error(trainingRescheduleErrorMessages.deleteNotFound);
    }
    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.completedRescheduleCannotDelete);
    }
    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error(trainingRescheduleErrorMessages.linkedReportCannotDelete);
    }

    await repository.deleteTrainingReschedule(parsed.id);
    await persistRescheduledPlan(
      context,
      reschedules.filter((item) => item.id !== existing.id),
    );
    revalidateAll();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete training reschedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
