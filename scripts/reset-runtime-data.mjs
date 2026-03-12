import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUNTIME_TABLES = [
  "coach_state",
  "daily_briefs",
  "session_reports",
  "plan_adjustments",
  "memory_summaries",
  "plan_snapshots",
  "chat_messages",
];

async function loadEnvFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function deleteAllRows({ url, serviceRoleKey, table }) {
  const response = await fetch(`${url}/rest/v1/${table}?id=not.is.null`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to clear ${table}: ${response.status} ${message}`);
  }
}

async function main() {
  const projectRoot = resolve(process.cwd());
  const envPath = resolve(projectRoot, ".env.local");
  const env = await loadEnvFile(envPath);
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.local");
  }

  for (const table of RUNTIME_TABLES) {
    await deleteAllRows({ url, serviceRoleKey, table });
    console.log(`cleared ${table}`);
  }

  console.log("runtime data reset complete");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
