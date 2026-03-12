"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/history", label: "History" },
  { href: "/setup", label: "Setup" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto w-[min(calc(100vw-1rem),30rem)] rounded-[24px] border border-black/10 bg-[rgba(19,22,17,0.96)] px-1.5 py-1.5 shadow-[0_18px_50px_rgba(18,22,16,0.3)] backdrop-blur">
      <div className="grid grid-cols-4 gap-1">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-w-0 items-center justify-center rounded-[16px] px-1 py-2.5 text-center text-[12px] font-semibold tracking-[0.01em] text-white/84 transition hover:text-white",
              active && "bg-[#d5ff63] text-[#151811] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
            )}
          >
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
      </div>
    </nav>
  );
}
