import { PlanEditor } from "@/components/plan-editor";
import { hasSupabaseConfig } from "@/lib/server/env";
import { getRepository } from "@/lib/server/repository";

export default async function PlanPage() {
  const repository = await getRepository();
  const planSetup = await repository.getPlanSetup();

  return <PlanEditor initialData={planSetup} storageMode={hasSupabaseConfig() ? "supabase" : "mock"} />;
}
