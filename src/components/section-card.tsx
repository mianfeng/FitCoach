import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionCardProps extends PropsWithChildren {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function SectionCard({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-black/10 bg-[rgba(255,252,245,0.84)] p-5 shadow-[0_24px_80px_rgba(30,24,14,0.12)] backdrop-blur sm:p-6",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(194,255,85,0.08),transparent_38%,rgba(27,31,23,0.04))]" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          {eyebrow ? <p className="text-[11px] uppercase tracking-[0.32em] text-black/45">{eyebrow}</p> : null}
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#151811]">{title}</h2>
          {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-black/62">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="relative mt-5">{children}</div>
    </section>
  );
}
