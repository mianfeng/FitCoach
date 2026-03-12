"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { ChatMessage, DashboardSnapshot } from "@/lib/types";
import { uid } from "@/lib/utils";

interface CoachConsoleProps {
  snapshot: DashboardSnapshot;
}

export function CoachConsole({ snapshot }: CoachConsoleProps) {
  const [messages, setMessages] = useState(snapshot.chatMessages);
  const [input, setInput] = useState("减脂和增肌阶段的碳水差别应该怎么理解？");
  const [contextSummary, setContextSummary] = useState(snapshot.plan.goal);
  const [isPending, startTransition] = useTransition();

  function send() {
    if (!input.trim()) {
      return;
    }

    const optimistic: ChatMessage = {
      id: uid("chat"),
      role: "user",
      content: input,
      basis: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setInput("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: optimistic.content }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "问答失败" }));
          throw new Error(error.error ?? "问答失败");
        }

        const data = (await response.json()) as {
          answer: string;
          basis: ChatMessage["basis"];
          contextSummary: string;
        };

        setContextSummary(data.contextSummary);
        setMessages((current) => [
          ...current,
          {
            id: uid("chat"),
            role: "assistant",
            content: data.answer,
            basis: data.basis,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: uid("chat"),
            role: "assistant",
            content: error instanceof Error ? error.message : "问答失败",
            basis: [],
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28 xl:grid-cols-[0.86fr_1.14fr]">
      <SectionCard eyebrow="Context" title="当前问答上下文" description="问答会优先读取正式计划、最近汇报和知识库片段。">
        <div className="space-y-4">
          <div className="rounded-[24px] bg-[#151811] p-5 text-white">
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Plan Summary</div>
            <p className="mt-3 text-sm leading-7 text-white/78">{contextSummary}</p>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
            <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Persona</div>
            <p className="mt-3 text-sm leading-7 text-black/66">{snapshot.persona.mission}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {snapshot.persona.corePrinciples.map((item) => (
                <span key={item} className="rounded-full bg-black/5 px-3 py-1.5 text-xs text-black/55">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
            <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Usage</div>
            <p className="mt-3 text-sm leading-7 text-black/62">
              理论问答走这里；今天怎么练怎么吃走首页。首页会生成固定快照，问答页只负责解释和答疑。
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard eyebrow="Coach Chat" title="教练问答台" description="回答会标出依据类别，避免把计划、资料和推断混在一起。">
        <div className="space-y-4">
          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "assistant"
                    ? "rounded-[24px] border border-black/10 bg-white/80 p-4"
                    : "ml-auto max-w-[88%] rounded-[24px] bg-[#151811] p-4 text-white"
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
                {message.role === "assistant" && message.basis.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {message.basis.map((basis) => (
                      <span key={`${message.id}-${basis.label}`} className="rounded-full bg-[#f3efdf] px-3 py-1.5 text-xs text-black/58">
                        {basis.type} · {basis.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <div className="rounded-[26px] border border-black/10 bg-[#faf7ef] p-4">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={4}
              className="w-full resize-none bg-transparent text-sm leading-7 outline-none"
              placeholder="例如：为什么休息日碳水要比训练日低 0.5g/kg？"
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-black/44">如果问题本质上是“今天怎么练怎么吃”，系统会提醒你回首页生成处方。</p>
              <button
                type="button"
                onClick={send}
                disabled={isPending}
                className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
              >
                {isPending ? "思考中..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
