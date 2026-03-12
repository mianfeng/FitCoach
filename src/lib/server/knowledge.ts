import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { KnowledgeChunk, KnowledgeDoc } from "@/lib/types";
import { normalizeText, segmentWords, uid } from "@/lib/utils";

interface ParsedSection {
  title: string;
  anchor: string;
  content: string[];
  tags: string[];
}

export function parseKnowledgeMarkdown(markdown: string, title: string, sourcePath: string) {
  const importedAt = new Date().toISOString();
  const docId = uid("doc");
  const doc: KnowledgeDoc = {
    id: docId,
    title,
    sourcePath,
    markdown,
    importedAt,
  };

  const sections: ParsedSection[] = [];
  const headingStack: string[] = [];
  let current: ParsedSection | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);

    if (headingMatch) {
      const depth = headingMatch[1].length;
      headingStack.splice(depth - 1);
      headingStack[depth - 1] = headingMatch[2].trim();
      current = {
        title: headingStack.filter(Boolean).join(" / "),
        anchor: headingStack.join("-").replace(/\s+/g, "-"),
        content: [],
        tags: segmentWords(headingMatch[2]).slice(0, 8),
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = {
        title,
        anchor: "intro",
        content: [],
        tags: segmentWords(title).slice(0, 8),
      };
      sections.push(current);
    }

    if (line) {
      current.content.push(line);
    }
  }

  const chunks: KnowledgeChunk[] = sections
    .map((section) => {
      const content = section.content.join("\n").trim();
      if (!content) {
        return null;
      }

      return {
        id: uid("chunk"),
        docId,
        title: section.title,
        content,
        anchor: section.anchor,
        tags: section.tags,
      };
    })
    .filter((item): item is KnowledgeChunk => item !== null);

  return { doc, chunks };
}

export async function loadLocalKnowledgeBundle() {
  const sourcePath = path.join(process.cwd(), "content", "knowledge", "fitness-core-theory.md");
  const markdown = await readFile(sourcePath, "utf8");
  return parseKnowledgeMarkdown(markdown, "健身核心理论手册 (V3.2 - 饮食全解析版)", sourcePath);
}

export function searchKnowledgeChunks(query: string, chunks: KnowledgeChunk[], limit = 3) {
  const queryTokens = new Set(segmentWords(query));
  const normalizedQuery = normalizeText(query);

  return chunks
    .map((chunk) => {
      const haystack = normalizeText(`${chunk.title} ${chunk.content} ${chunk.tags.join(" ")}`);
      let score = 0;
      for (const token of queryTokens) {
        if (token.length < 2) {
          continue;
        }
        if (haystack.includes(token)) {
          score += chunk.title.includes(token) ? 4 : 2;
        }
      }
      if (normalizedQuery && haystack.includes(normalizedQuery)) {
        score += 6;
      }
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}
