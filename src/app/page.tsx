import { HomeDashboard } from "@/components/home-dashboard";
import { getRepository } from "@/lib/server/repository";
import { isoToday } from "@/lib/utils";

export default async function Home() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();

  return <HomeDashboard snapshot={snapshot} today={isoToday()} />;
}
