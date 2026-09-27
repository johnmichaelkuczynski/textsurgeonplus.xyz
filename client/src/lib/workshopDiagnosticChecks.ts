import { splitWorkshopDocument, WORKSHOP_CHUNK_CHARS } from "@/lib/humanizerChunks";

export type CheckEvidence = { evidence: string; httpStatus?: number; degradedReason?: string };

async function jsonResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || payload?.message || `HTTP ${response.status} ${response.statusText}`;
    throw Object.assign(new Error(`${message} (HTTP ${response.status})`), { httpStatus: response.status });
  }
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error(`The server returned no JSON (HTTP ${response.status}).`), { httpStatus: response.status });
  }
  return payload;
}

function diagnosticPdf() {
  const text = "Diagnostic style sample uses clear and measured prose.";
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export async function checkUpload(path: string, signal: AbortSignal): Promise<CheckEvidence> {
  const form = new FormData();
  form.append("file", diagnosticPdf(), "diagnostic.pdf");
  const response = await fetch(path, { method: "POST", body: form, credentials: "include", signal });
  const payload = await jsonResponse(response);
  if (typeof payload.text !== "string" || !payload.text.includes("clear and measured prose")) {
    throw new Error("The PDF parser did not extract the known sample text.");
  }
  return { evidence: `PDF extracted ${payload.text.length} characters correctly.`, httpStatus: response.status };
}

export async function checkPresets(): Promise<CheckEvidence> {
  const { humanizerStylePresets } = await import("@/data/humanizerStylePresets");
  if (humanizerStylePresets.length !== 50 ||
      new Set(humanizerStylePresets.map((preset) => preset.id)).size !== 50 ||
      humanizerStylePresets.some((preset) => !preset.instruction.trim() || preset.instruction.length > 3_000)) {
    throw new Error("The 50 supplied style presets are missing, duplicated, empty, or too long for Box C.");
  }
  return { evidence: "All 50 selectable Box C instructions loaded, unique, and within the API limit." };
}

export async function checkMultiPartRewrite(signal: AbortSignal): Promise<CheckEvidence> {
  const text = Array.from({ length: 40 }, (_, i) =>
    `Paragraph ${i + 1}: The archive preserves original reports so readers can compare evidence, track revisions, and understand the argument in context.\n\n`,
  ).join("");
  const parts = splitWorkshopDocument(text);
  if (parts.length < 2 || parts.some((part) => part.length > WORKSHOP_CHUNK_CHARS) || parts.join("") !== text) {
    throw new Error("The document splitter lost text or produced an oversized part.");
  }
  // Exercise the actual rewrite route in sequence, not just the local splitter.
  let previous = "";
  const substitutions: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    const part = parts[index];
    const instructions = `Part ${index + 1} of ${parts.length}. Rewrite only this part without a new introduction or conclusion. Preserve its subject and approximate length.${previous ? ` Previous part ended: ${previous.slice(-100)}` : ""}`;
    const response = await fetch("/api/humanizer/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal,
      body: JSON.stringify({ text: part, provider: "gemini", instructions }),
    });
    const payload = await jsonResponse(response);
    if (typeof payload.text !== "string" || payload.text.trim().length < 30) {
      throw new Error(`Part ${index + 1} returned no usable rewrite.`);
    }
    if (payload.provider !== "gemini") {
      substitutions.push(`Part ${index + 1}: ${payload.provider || "unknown provider"} substituted. ${payload.fallbackReason || ""}`);
    }
    previous = payload.text.trim();
  }
  return {
    evidence: `${parts.length} consecutive parts completed through the real rewrite route; all source characters were assigned to a part.`,
    httpStatus: 200,
    degradedReason: substitutions.length ? substitutions.join(" ") : undefined,
  };
}

export async function checkTts(signal: AbortSignal): Promise<CheckEvidence> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify({ text: "This is a diagnostic audio test.", format: "mp3", mode: "single" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(`${payload?.error || `Audio request failed (HTTP ${response.status})`}`), { httpStatus: response.status });
  }
  const blob = await response.blob();
  if (!response.headers.get("content-type")?.includes("audio") || blob.size < 100) {
    throw new Error("The audio endpoint did not return usable audio.");
  }
  return { evidence: `ElevenLabs returned ${blob.size.toLocaleString()} bytes of audio.`, httpStatus: response.status };
}

export async function checkStripePublic(signal: AbortSignal): Promise<CheckEvidence> {
  const response = await fetch("/api/stripe-publishable-key", { credentials: "include", signal });
  const payload = await jsonResponse(response);
  if (typeof payload.key !== "string" || !payload.key.startsWith("pk_")) {
    throw new Error("Stripe publishable key is not configured. This does not check the secret or webhook keys.");
  }
  return { evidence: "Stripe publishable key is configured. Secret and webhook credentials are not verified by this endpoint.", httpStatus: response.status };
}