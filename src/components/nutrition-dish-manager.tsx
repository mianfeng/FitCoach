"use client";

import { useMemo, useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { NutritionDish } from "@/lib/types";

interface NutritionDishManagerProps {
  initialDishes: NutritionDish[];
}

type DishFormState = {
  id?: string;
  name: string;
  aliasesText: string;
  proteinG: number;
  carbsG: number;
  fatsG: number;
};

const emptyForm: DishFormState = {
  name: "",
  aliasesText: "",
  proteinG: 0,
  carbsG: 0,
  fatsG: 0,
};

function toAliases(text: string) {
  return [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
}

function toKcal(proteinG: number, carbsG: number, fatsG: number) {
  return Math.round((proteinG * 4 + carbsG * 4 + fatsG * 9) * 10) / 10;
}

export function NutritionDishManager({ initialDishes }: NutritionDishManagerProps) {
  const [dishes, setDishes] = useState(initialDishes);
  const [form, setForm] = useState<DishFormState>(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sortedDishes = useMemo(
    () => [...dishes].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    [dishes],
  );

  const kcal = toKcal(form.proteinG, form.carbsG, form.fatsG);

  function resetForm() {
    setForm(emptyForm);
  }

  function editDish(dish: NutritionDish) {
    setForm({
      id: dish.id,
      name: dish.name,
      aliasesText: dish.aliases.join(", "),
      proteinG: dish.macros.proteinG,
      carbsG: dish.macros.carbsG,
      fatsG: dish.macros.fatsG,
    });
    setFeedback(null);
  }

  function removeDish(id: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/nutrition-dishes/${id}`, { method: "DELETE" });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "删除失败" }));
          throw new Error(error.error ?? "删除失败");
        }
        setDishes((current) => current.filter((item) => item.id !== id));
        if (form.id === id) {
          resetForm();
        }
        setFeedback("菜品已删除。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "删除失败");
      }
    });
  }

  function saveDish() {
    if (!form.name.trim()) {
      setFeedback("请先填写菜品名称。");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/nutrition-dishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: form.id,
            name: form.name.trim(),
            aliases: toAliases(form.aliasesText),
            macros: {
              proteinG: form.proteinG,
              carbsG: form.carbsG,
              fatsG: form.fatsG,
            },
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "保存失败" }));
          throw new Error(error.error ?? "保存失败");
        }
        const data = (await response.json()) as { dish: NutritionDish };
        setDishes((current) => [data.dish, ...current.filter((item) => item.id !== data.dish.id)]);
        setFeedback(form.id ? "菜品已更新。" : "菜品已添加。");
        resetForm();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  return (
    <SectionCard
      eyebrow="Nutrition"
      title="菜品添加"
      description="按每份录入 P/C/F，系统会自动换算 kcal。可用逗号补充别名，提高文本识别命中率。"
    >
      <div className="space-y-3 rounded-[22px] border border-black/10 bg-white/80 p-4">
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">Name</span>
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="mt-2 w-full rounded-[14px] border border-black/10 bg-white px-3 py-2.5 text-sm outline-none"
            placeholder="例如：鸡腿饭"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">Aliases</span>
          <input
            value={form.aliasesText}
            onChange={(event) => setForm((current) => ({ ...current, aliasesText: event.target.value }))}
            className="mt-2 w-full rounded-[14px] border border-black/10 bg-white px-3 py-2.5 text-sm outline-none"
            placeholder="例如：鸡排饭, 鸡腿盖饭"
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block rounded-[14px] border border-black/10 bg-[#f6f2e6] px-3 py-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-black/42">Protein g</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.proteinG}
              onChange={(event) => setForm((current) => ({ ...current, proteinG: Number(event.target.value) }))}
              className="mt-2 w-full bg-transparent text-base font-semibold text-[#151811] outline-none"
            />
          </label>
          <label className="block rounded-[14px] border border-black/10 bg-[#f6f2e6] px-3 py-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-black/42">Carbs g</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.carbsG}
              onChange={(event) => setForm((current) => ({ ...current, carbsG: Number(event.target.value) }))}
              className="mt-2 w-full bg-transparent text-base font-semibold text-[#151811] outline-none"
            />
          </label>
          <label className="block rounded-[14px] border border-black/10 bg-[#f6f2e6] px-3 py-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-black/42">Fats g</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.fatsG}
              onChange={(event) => setForm((current) => ({ ...current, fatsG: Number(event.target.value) }))}
              className="mt-2 w-full bg-transparent text-base font-semibold text-[#151811] outline-none"
            />
          </label>
        </div>

        <div className="rounded-[14px] bg-[#151811] px-3 py-2 text-sm font-semibold text-white">
          估算热量: {kcal} kcal / 份
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveDish}
            disabled={isPending}
            className="rounded-full bg-[#151811] px-4 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
          >
            {form.id ? "更新菜品" : "添加菜品"}
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="rounded-full border border-black/12 px-4 py-2 text-sm font-semibold text-[#151811] disabled:opacity-60"
            >
              取消编辑
            </button>
          ) : null}
        </div>
        {feedback ? <div className="text-sm text-black/62">{feedback}</div> : null}
      </div>

      <div className="mt-4 space-y-2">
        {sortedDishes.length ? (
          sortedDishes.map((dish) => (
            <article key={dish.id} className="rounded-[18px] border border-black/10 bg-white/80 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#151811]">{dish.name}</div>
                  <div className="mt-1 text-xs text-black/58">
                    {toKcal(dish.macros.proteinG, dish.macros.carbsG, dish.macros.fatsG)} kcal / P {dish.macros.proteinG} / C{" "}
                    {dish.macros.carbsG} / F {dish.macros.fatsG}
                  </div>
                  <div className="mt-1 text-xs text-black/52">
                    别名: {dish.aliases.length ? dish.aliases.join(", ") : "无"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => editDish(dish)}
                    disabled={isPending}
                    className="rounded-full border border-black/12 px-3 py-1.5 text-xs font-semibold text-[#151811] disabled:opacity-60"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDish(dish.id)}
                    disabled={isPending}
                    className="rounded-full border border-[#e6b5a8] px-3 py-1.5 text-xs font-semibold text-[#7c2f1f] disabled:opacity-60"
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <article className="rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 text-sm text-black/58">
            还没有自定义菜品。先添加常吃菜，之后在 today 餐次输入里可直接识别。
          </article>
        )}
      </div>
    </SectionCard>
  );
}
