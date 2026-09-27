import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureNames = {
  input: "Pasted-THIS-IS-GOING-TO-A-MASSIVE-OVERHAUL-STEP-1-READ-AND-ABS_1790531934108.txt",
  style: "Pasted-The-Concept-of-Natural-Law-in-relation-to-the-problem-o_1790532119938.txt",
  prompts: "Pasted-Rewrite-in-style-of-sample-breaking-the-text-into-short_1790532503789.txt",
} as const;

export async function loadHumanizerDiagnosticFixtures() {
  const [input, style, rawPrompts] = await Promise.all(
    Object.values(fixtureNames).map((name) =>
      readFile(join(process.cwd(), "attached_assets", name), "utf8"),
    ),
  );
  const prompts = rawPrompts
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  if (!input.trim() || !style.trim() || prompts.length < 10) {
    throw new Error("The supplied diagnostic fixtures are incomplete.");
  }
  return { input, style, prompts };
}