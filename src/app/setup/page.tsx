import { RuntimeChecklist } from "@/components/runtime-checklist";
import { getRuntimeStatus } from "@/lib/server/status";

export default async function SetupPage() {
  const status = await getRuntimeStatus();

  return <RuntimeChecklist status={status} />;
}
