"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function UnlockPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function unlock() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/unlock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accessToken }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "解锁失败" }));
          throw new Error(error.error ?? "解锁失败");
        }
        router.replace("/");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "解锁失败");
      }
    });
  }

  return (
    <main className="flex min-h-[82vh] items-center justify-center">
      <div className="w-full max-w-md rounded-[32px] border border-black/10 bg-[rgba(255,252,245,0.9)] p-6 shadow-[0_28px_80px_rgba(30,24,14,0.18)]">
        <p className="text-[11px] uppercase tracking-[0.34em] text-black/42">Access Gate</p>
        <h1 className="mt-3 font-display text-5xl uppercase tracking-[0.06em] text-[#151811]">Unlock</h1>
        <p className="mt-3 text-sm leading-6 text-black/62">
          这个实例已启用单用户门禁。输入你的访问口令后再进入训练计划和历史记录。
        </p>
        <input
          type="password"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
          className="mt-6 w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
          placeholder="FITCOACH_ACCESS_TOKEN"
        />
        <button
          type="button"
          onClick={unlock}
          disabled={isPending}
          className="mt-4 w-full rounded-full bg-[#151811] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
        >
          {isPending ? "验证中..." : "进入 FitCoach"}
        </button>
        {feedback ? <p className="mt-3 text-sm text-black/56">{feedback}</p> : null}
      </div>
    </main>
  );
}
