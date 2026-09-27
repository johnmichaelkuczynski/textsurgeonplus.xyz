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