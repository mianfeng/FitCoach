"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/ask", label: "Coach" },
  { href: "/history", label: "History" },
  { href: "/setup", label: "Setup" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(92vw,480px)] items-center justify-between rounded-full border border-black/10 bg-[rgba(19,22,17,0.92)] px-3 py-2 shadow-[0_18px_50px_rgba(18,22,16,0.28)] backdrop-blur">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium text-white/62 transition hover:text-white",
              active && "bg-[#d5ff63] text-[#151811]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
