import type { ReactNode } from "react";
import Link from "next/link";

import { SectionCard } from "@/components/section-card";
import type { RuntimeStatus } from "@/lib/server/status";

interface RuntimeChecklistProps {
  status: RuntimeStatus;
  dishManager?: ReactNode;
}

export function RuntimeChecklist({ status, dishManager }: RuntimeChecklistProps) {
  return (
    <div className={`grid gap-5 pb-28 ${dishManager ? "xl:grid-cols-[0.72fr_0.98fr_1fr]" : "xl:grid-cols-[0.9fr_1.1fr]"}`}>
      <SectionCard
        eyebrow="Runtime"
        title="当前运行状态"
        description="这一页只看系统是否已经从演示态进入真实可长期使用态。"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Storage", value: status.storageMode },
            { label: "Gemini", value: status.geminiConfigured ? "ready" : "missing" },
            { label: "Access Gate", value: status.accessGateEnabled ? "enabled" : "off" },
            { label: "Knowledge", value: `${status.knowledgeDocs}/${status.knowledgeChunks}` },
          ].map((item) => (
            <div key={item.label} className="rounded-[22px] border border-black/10 bg-white/78 p-4">
              <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-[#151811]">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-[24px] bg-[#151811] p-5 text-white">
          <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Ready For Persistent Use</div>
          <div className="mt-3 text-3xl font-semibold">{status.readyForPersistentUse ? "YES" : "NOT YET"}</div>
          <p className="mt-3 text-sm leading-6 text-white/72">
            持久化使用至少需要真实存储和公网门禁。Gemini 不配置也能用，但问答质量会低一档。
          </p>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Checklist"
        title="下一步接入清单"
        description="先把这一页的警告清空，再去调 UI，会更有效。"
      >
        <div className="space-y-3">
          {status.warnings.length ? (
            status.warnings.map((warning) => (
              <article key={warning} className="rounded-[22px] border border-black/10 bg-white/80 p-4 text-sm leading-6 text-black/62">
                • {warning}
              </article>
            ))
          ) : (
            <article className="rounded-[22px] border border-black/10 bg-white/80 p-4 text-sm leading-6 text-black/62">
              所有关键运行项都已就绪，可以开始做真实数据录入和 UI 微调。
            </article>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] bg-[#f6f2e6] p-4 text-sm leading-6 text-black/62">
            <div className="font-semibold text-[#151811]">持久化</div>
            <p className="mt-2">执行 [schema.sql](/H:/other/workspeace/FitCoach/fitcoach-web/supabase/schema.sql)，再填 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。</p>
          </div>
          <div className="rounded-[22px] bg-[#f6f2e6] p-4 text-sm leading-6 text-black/62">
            <div className="font-semibold text-[#151811]">问答质量</div>
            <p className="mt-2">填 `GEMINI_API_KEY`，理论问答和上下文摘要会从回退逻辑切到真实模型。</p>
          </div>
          <div className="rounded-[22px] bg-[#f6f2e6] p-4 text-sm leading-6 text-black/62">
            <div className="font-semibold text-[#151811]">公网安全</div>
            <p className="mt-2">填 `FITCOACH_ACCESS_TOKEN`，部署到 Vercel 后先过 `/unlock` 再进入主系统。</p>
          </div>
          <div className="rounded-[22px] bg-[#f6f2e6] p-4 text-sm leading-6 text-black/62">
            <div className="font-semibold text-[#151811]">当前数据</div>
            <p className="mt-2">最近已有 {status.recentReportCount} 条汇报，待确认提案 {status.pendingProposalCount} 条。</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/plan"
            className="rounded-full bg-[#151811] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
          >
            去调整正式计划
          </Link>
          <Link
            href="/"
            className="rounded-full border border-black/12 px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-black/4"
          >
            回到今日处方
          </Link>
        </div>
      </SectionCard>
      {dishManager ? dishManager : null}
    </div>
  );
}
