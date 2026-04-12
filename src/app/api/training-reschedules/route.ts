import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { materializePlanCalendar } from "@/lib/plan-calendar";
import { buildPlanSnapshots } from "@/lib/plan-generator";
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
      throw new Error("鍙兘璋冩暣璁粌鏃ワ紝浼戞伅鏃ヤ笉鑳介『寤躲€?");
    }
    if (parsed.targetDate <= parsed.sourceDate) {
      throw new Error("目标日期必须晚于原训练日。");
    }
    if (completedScheduledDates.has(parsed.sourceDate)) {
      throw new Error("杩欎釜璁粌鏃ュ凡缁忓畬鎴愶紝涓嶈兘鍐嶈皟鏁淬€?");
    }
    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error("鐩爣鏃ユ湡宸茬粡鏈夎缁冭褰曪紝涓嶈兘鍐嶅鍏ユ柊鐨勮缁冩棩銆?");
    }
    if (reschedules.some((item) => item.sourceDate === parsed.sourceDate)) {
      throw new Error("杩欎釜璁粌鏃ュ凡缁忚璋冩暣杩囦簡銆?");
    }
    if (reschedules.some((item) => item.targetDate === parsed.targetDate)) {
      throw new Error("鐩爣鏃ユ湡宸茬粡鎵挎帴浜嗗埆鐨勮缁冩棩銆?");
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
      throw new Error("娌℃湁鎵惧埌瑕佹敼鏈熺殑椤哄欢璁板綍銆?");
    }
    if (parsed.targetDate <= existing.sourceDate) {
      throw new Error("目标日期必须晚于原训练日。");
    }
    if (existing.sourceDate === parsed.targetDate) {
      throw new Error("鐩爣鏃ユ湡涓嶈兘鍜屽師鏃ユ湡鐩稿悓銆?");
    }
    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error("杩欐潯椤哄欢瀵瑰簲鐨勮缁冨凡缁忓畬鎴愶紝涓嶈兘鍐嶆敼鏈熴€?");
    }
    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error("杩欐潯椤哄欢宸茬粡鏈夊叧鑱旇褰曪紝涓嶈兘鍐嶆敼鏈熴€?");
    }
    if (reports.some((report) => report.date === parsed.targetDate)) {
      throw new Error("鐩爣鏃ユ湡宸茬粡鏈夎缁冭褰曪紝涓嶈兘鍐嶆敼鍒拌繖閲屻€?");
    }
    if (reschedules.some((item) => item.id !== existing.id && item.targetDate === parsed.targetDate)) {
      throw new Error("鐩爣鏃ユ湡宸茬粡鎵挎帴浜嗗埆鐨勮缁冩棩銆?");
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
      throw new Error("娌℃湁鎵惧埌瑕佸彇娑堢殑椤哄欢璁板綍銆?");
    }
    if (completedScheduledDates.has(existing.sourceDate)) {
      throw new Error("杩欐潯椤哄欢瀵瑰簲鐨勮缁冨凡缁忓畬鎴愶紝涓嶈兘鍙栨秷銆?");
    }
    if (findReportForDate(reports, existing.sourceDate)) {
      throw new Error("杩欐潯椤哄欢宸茬粡鏈夊叧鑱旇褰曪紝涓嶈兘鍙栨秷銆?");
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
