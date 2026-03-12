import { HistoryView } from "@/components/history-view";
import { getRepository } from "@/lib/server/repository";

export default async function HistoryPage() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();

  return <HistoryView snapshot={snapshot} />;
}
