import { PlanEditor } from "@/components/plan-editor";
import { hasSupabaseConfig } from "@/lib/server/env";
import { getRepository } from "@/lib/server/repository";
import { isoToday } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlanPage() {
  const repository = await getRepository();
  const planSetup = await repository.getPlanSetup();
  const reports = await repository.listSessionReports(120);

  return (
    <PlanEditor
      initialData={planSetup}
      recentReports={reports}
      today={isoToday()}
      storageMode={hasSupabaseConfig() ? "supabase" : "mock"}
    />
  );
}
