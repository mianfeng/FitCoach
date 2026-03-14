import { NutritionDishManager } from "@/components/nutrition-dish-manager";
import { RuntimeChecklist } from "@/components/runtime-checklist";
import { getRepository } from "@/lib/server/repository";
import { getRuntimeStatus } from "@/lib/server/status";

export default async function SetupPage() {
  const status = await getRuntimeStatus();
  const repository = await getRepository();
  const dishes = await repository.listNutritionDishes();

  return <RuntimeChecklist status={status} dishManager={<NutritionDishManager initialDishes={dishes} />} />;
}
