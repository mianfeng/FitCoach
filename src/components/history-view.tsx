"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { DashboardSnapshot, SessionReport } from "@/lib/types";

interface HistoryViewProps {
  snapshot: DashboardSnapshot;
}

function summarizeMealLog(report: SessionReport) {
  if (!report.mealLog) {
    return [];
  }

  const postWorkoutLine =
    report.mealLog.postWorkoutSource === "lunch"
      ? `练后餐：午餐 (${report.mealLog.lunch || "未填写"})`
      : report.mealLog.postWorkoutSource === "dinner"
        ? `练后餐：晚餐 (${report.mealLog.dinner || "未填写"})`
        : `练后餐：${report.mealLog.postWorkout || "未填写"}`;

  return [
    `早餐：${report.mealLog.breakfast || "未填写"}`,
    `午餐：${report.mealLog.lunch || "未填写"}`,
    `晚餐：${report.mealLog.dinner || "未填写"}`,
    `练前餐：${report.mealLog.preWorkout || "未填写"}`,
    postWorkoutLine,
  ];
}

function renderReportBody(report: SessionReport) {
  if (report.mealLog || report.trainingReportText || report.dailyReviewMarkdown) {
    const mealLines = summarizeMealLog(report);

    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm text-black/62">
          体重 {report.bodyWeightKg}kg / 睡眠 {report.sleepHours}h / 疲劳 {report.fatigue}/10
        </p>
        {report.trainingReportText ? (
          <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-black/64">
            {report.trainingReportText}
          </div>
        ) : null}
        {mealLines.length ? (
          <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-black/64">
            {mealLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
        {report.dailyReviewMarkdown ? (
          <div className="rounded-[18px] border border-[#cddfa0] bg-[#f4f9e6] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Daily Review</div>
            <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#151811]">
              {report.dailyReviewMarkdown}
            </pre>
          </div>
        ) : null}
      </div>
    );
  }

  const exerciseSummary = (report.exerciseResults ?? [])
    .map((item) => `${item.exerciseName} ${item.topSetWeightKg ?? "-"}kg`)
    .join(" · ");

  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-black/62">
        体重 {report.bodyWeightKg}kg / 睡眠 {report.sleepHours}h / 饮食达标 {report.dietAdherence ?? "-"} / 5
      </p>
      <p className="text-sm leading-6 text-black/56">{exerciseSummary || "无动作明细"}</p>
    </div>
  );
}

export function HistoryView({ snapshot }: HistoryViewProps) {
  const [proposals, setProposals] = useState(snapshot.proposals);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function approve(id: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/plan-adjustments/${id}/approve`, { method: "POST" });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "批准失败" }));
          throw new Error(error.error ?? "批准失败");
        }
        const data = (await response.json()) as { proposal: (typeof proposals)[number] };
        setProposals((current) => current.map((item) => (item.id === id ? data.proposal : item)));
        setFeedback("提案已批准并写回正式计划。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "批准失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28 xl:grid-cols-[1fr_1fr]">
      <SectionCard
        eyebrow="Reports"
        title="最近训练与饮食汇报"
        description="这里保存你最近的执行痕迹，是后续问答和处方的历史依据。"
      >
        <div className="space-y-3">
          {snapshot.recentReports.length ? (
            snapshot.recentReports.map((report) => (
              <article key={report.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-black/42">{report.date}</div>
                    <div className="mt-1 text-lg font-semibold text-[#151811]">
                      {report.performedDay === "rest" ? "休息日" : `${report.performedDay} 日`}
                    </div>
                  </div>
                  <div className="rounded-full bg-[#151811] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/70">
                    Fatigue {report.fatigue}
                  </div>
                </div>
                {renderReportBody(report)}
              </article>
            ))
          ) : (
            <p className="text-sm text-black/55">还没有历史汇报，首页提交第一条之后这里会开始累积。</p>
          )}
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard eyebrow="Summaries" title="记忆摘要" description="系统会从汇报中提炼出每天最重要的信号。">
          <div className="space-y-3">
            {snapshot.summaries.length ? (
              snapshot.summaries.map((summary) => (
                <article key={summary.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-black/42">{summary.date}</div>
                  <p className="mt-2 text-sm font-medium text-[#151811]">{summary.summary}</p>
                  <p className="mt-2 text-xs text-black/50">{summary.signals.join(" / ")}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-black/55">还没有记忆摘要。</p>
            )}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Approval" title="计划调整提案" description="所有对正式计划的修改都需要在这里批准。">
          <div className="space-y-3">
            {proposals.length ? (
              proposals.map((proposal) => (
                <article key={proposal.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-black/42">{proposal.scope}</div>
                      <div className="mt-1 text-base font-semibold text-[#151811]">{proposal.triggerReason}</div>
                    </div>
                    <div className="rounded-full bg-[#f2eedf] px-3 py-1 text-xs uppercase tracking-[0.24em] text-black/60">
                      {proposal.status}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-black/60">{proposal.rationale}</p>
                  {proposal.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => approve(proposal.id)}
                      disabled={isPending}
                      className="mt-4 rounded-full bg-[#d5ff63] px-4 py-2 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
                    >
                      批准并写回计划
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-black/55">当前没有待确认提案。</p>
            )}
            {feedback ? <p className="text-sm text-black/56">{feedback}</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
