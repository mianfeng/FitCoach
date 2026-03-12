import type { Metadata, Viewport } from "next";

import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitCoach",
  description: "长期计划驱动的每日训练与饮食处方助手",
  applicationName: "FitCoach",
};

export const viewport: Viewport = {
  themeColor: "#151811",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <div className="relative mx-auto min-h-screen max-w-[1440px] px-4 pb-8 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(213,255,99,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(255,179,71,0.14),transparent_24%),linear-gradient(180deg,#f3efe4_0%,#ebe6d7_100%)]" />
          {children}
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
