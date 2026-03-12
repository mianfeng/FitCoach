import { HomeDashboard } from "@/components/home-dashboard";
import { buildTodayAutofillBrief } from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import { isoToday } from "@/lib/utils";

export default async function Home() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();
  const today = isoToday();
  const todayBrief = buildTodayAutofillBrief(
    today,
    snapshot.profile,
    snapshot.plan,
    snapshot.templates,
    snapshot.recentReports,
  );

  return <HomeDashboard snapshot={snapshot} today={today} todayBrief={todayBrief} />;
}
