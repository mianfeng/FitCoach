import { HistoryView } from "@/components/history-view";
import { getRepository } from "@/lib/server/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HistoryPage() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();

  return <HistoryView snapshot={snapshot} />;
}
