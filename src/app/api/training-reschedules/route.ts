import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { buildTodayAutofillBrief } from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import { findReportForDate, getCompletedScheduledDateSet } from "@/lib/training-reschedule";
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

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = trainingRescheduleSchema.parse(payload);
    const { repository, snapshot, reports, reschedules, completedScheduledDates } = await loadRescheduleContext();
    const sourceBrief = buildTodayAutofillBrief(
      parsed.sourceDate,
      snapshot.profile,
      snapshot.plan,
      snapshot.templates,
      reports,
    );

    if (sourceBrief.calendarSlot === "rest") {
      throw new Error("只能调整训练日，休息日不能顺延。");
    }

    if (completedScheduledDates.has(parsed.sourceDate)) {
      throw new Error("这个训练日已经完成，不能再调整。");
    }

    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error("目标日期已经有训练记录，不能再塞入新的训练日。");
    }

    if (reschedules.some((item) => item.sourceDate === parsed.sourceDate)) {
      throw new Error("这个训练日已经被调整过了。");
    }

    if (reschedules.some((item) => item.targetDate === parsed.targetDate)) {
      throw new Error("目标日期已经承接了别的训练日。");
    }

    const reschedule = {
      id: uid("reschedule"),
      sourceDate: parsed.sourceDate,
      targetDate: parsed.targetDate,
      sourceDay: sourceBrief.calendarSlot,
      sourceLabel: sourceBrief.calendarLabel,
      action: parsed.sourceDate < parsed.targetDate ? ("postpone" as const) : ("advance" as const),
      note: parsed.note,
      createdAt: new Date().toISOString(),
    };

    const saved = await repository.saveTrainingReschedule(reschedule);
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
    const { repository, reports, reschedules, completedScheduledDates } = await loadRescheduleContext();
    const existing = reschedules.find((item) => item.id === parsed.id);

    if (!existing) {
      throw new Error("没有找到要改期的顺延记录。");
    }

    if (existing.sourceDate === parsed.targetDate) {
      throw new Error("目标日期不能和原日期相同。");
    }

    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error("这条顺延对应的训练已经完成，不能再改期。");
    }

    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error("这条顺延已经有关联记录，不能再改期。");
    }

    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error("目标日期已经有训练记录，不能再改到这里。");
    }

    if (reschedules.some((item) => item.id !== existing.id && item.targetDate === parsed.targetDate)) {
      throw new Error("目标日期已经承接了别的训练日。");
    }

    const updated = {
      ...existing,
      targetDate: parsed.targetDate,
      note: parsed.note ?? existing.note,
      action: existing.sourceDate < parsed.targetDate ? ("postpone" as const) : ("advance" as const),
    };

    const saved = await repository.saveTrainingReschedule(updated);
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
    const { repository, reports, reschedules, completedScheduledDates } = await loadRescheduleContext();
    const existing = reschedules.find((item) => item.id === parsed.id);

    if (!existing) {
      throw new Error("没有找到要取消的顺延记录。");
    }

    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error("这条顺延对应的训练已经完成，不能取消。");
    }

    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error("这条顺延已经有关联记录，不能取消。");
    }

    await repository.deleteTrainingReschedule(parsed.id);
    revalidateAll();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete training reschedule";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
