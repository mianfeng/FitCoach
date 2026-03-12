import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FitCoach",
    short_name: "FitCoach",
    description: "长期计划驱动的每日训练与饮食处方助手",
    start_url: "/",
    display: "standalone",
    background_color: "#ebe6d7",
    theme_color: "#151811",
    lang: "zh-CN",
  };
}
