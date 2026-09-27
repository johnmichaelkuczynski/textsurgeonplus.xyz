import type { CheckEvidence } from "@/lib/workshopDiagnosticChecks";

export const CORE_FUNCTIONS = [
  { id: "quotes", label: "Quotes" },
  { id: "context", label: "Context" },
  { id: "rewrite", label: "Rewrite" },
  { id: "database", label: "Database analysis" },
  { id: "analyzer", label: "Analyzer" },
  { id: "views", label: "Views" },
] as const;

const fixture = "On Monday the archive received the original report. The report said, \"The record was checked twice.\" On Tuesday a revised report arrived and changed the date of one entry. The archivist kept both reports in order so readers could compare the wording, identify the change, and understand its context.";

export async function checkCoreFunction(
  functionType: (typeof CORE_FUNCTIONS)[number]["id"],
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<CheckEvidence> {
  // Omit username: the analysis route saves history when a username is supplied.
  const response = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify({ text: fixture, provider: "openai", functionType }),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(payload?.error || `The ${functionType} stream did not open (HTTP ${response.status}).`), { httpStatus: response.status });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let finished = false;
  const handleEvent = (event: string) => {
    const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) return;
    const payload = JSON.parse(data);
    if (payload.error) throw new Error(`${functionType}: ${payload.error}`);
    if (typeof payload.content === "string") {
      output += payload.content;
      onChunk(payload.content);
    }
    if (payload.done) finished = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) handleEvent(event);
      if (done) break;
    }
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!finished || !output.trim()) throw new Error(`${functionType} ended without a completed, nonempty streamed result.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`${functionType} streamed text but not the structured JSON required by the main app.`);
  }
  if (!parsed || typeof parsed !== "object" || !Object.keys(parsed).length) {
    throw new Error(`${functionType} returned an empty result object.`);
  }
  return {
    evidence: `OpenAI streamed ${output.length.toLocaleString()} characters for ${functionType} and returned a nonempty JSON object.\n\n${output}`,
    httpStatus: response.status,
  };
}