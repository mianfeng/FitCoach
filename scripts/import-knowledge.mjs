import fs from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2] ?? path.join(process.cwd(), "content", "knowledge", "fitness-core-theory.md");
const baseUrl = process.env.FITCOACH_BASE_URL ?? "http://localhost:3000";

const markdown = await fs.readFile(sourcePath, "utf8");
const response = await fetch(`${baseUrl}/api/knowledge/import`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    markdown,
    title: "健身核心理论手册 (V3.2 - 饮食全解析版)",
    sourcePath,
  }),
});

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

console.log(await response.text());
