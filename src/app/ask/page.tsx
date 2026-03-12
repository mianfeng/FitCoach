import { CoachConsole } from "@/components/coach-console";
import { getRepository } from "@/lib/server/repository";

export default async function AskPage() {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();

  return <CoachConsole snapshot={snapshot} />;
}
