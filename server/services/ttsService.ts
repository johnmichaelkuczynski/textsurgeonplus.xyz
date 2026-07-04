const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";

// ElevenLabs premade voice IDs
export const TTS_VOICES = [
  "pNInz6obpgDQGcFmaJgB", // Adam — dominant male
  "nPczCjzI2devNBz1zQrb", // Brian — deep resonant male
  "JBFqnCBsd6RMkjVDRZzb", // George — British storyteller
  "onwK4e9ZLuTAKqWW03F9", // Daniel — British broadcaster
  "IKne3meq5aSn9XLyUdCD", // Charlie — Australian male
  "pqHfZKP75CvOlQylNhV4", // Bill — wise older male
  "EXAVITQu4vr4xnSDxMaL", // Sarah — confident female
  "XrExE9yKIg1WjnnlVkGX", // Matilda — professional female
  "Xb7hH8MSUJpSbSDYk0k2", // Alice — British female
  "pFZP5JQG7iQjIQuC4Bku", // Lily — velvety British female
  "cgSgspJ2msm6clMCkdW9", // Jessica — playful female
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export interface SpeakerConfig {
  name: string;
  voice: TtsVoice;
}

export interface TtsRequest {
  text: string;
  format: "mp3" | "wav";
  mode: "single" | "multi";
  voice?: TtsVoice;
  speakers?: SpeakerConfig[];
  instructions?: string;
}

const MAX_CHUNK_CHARS = 3500;
const PCM_SAMPLE_RATE = 24000;

function getElevenLabsKey(): string {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY not configured. Add it as an environment variable.");
  return key;
}

function getOpenAiKey(): string {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY not configured. Add it as an environment variable.");
  return key;
}

export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) {
        const piece = sentence.slice(i, i + maxChars);
        if (current.trim()) { chunks.push(current.trim()); current = ""; }
        chunks.push(piece.trim());
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

async function synthesizeChunk(
  text: string,
  voice: TtsVoice,
  format: "mp3" | "wav",
): Promise<Buffer> {
  const outputFormat = format === "wav" ? `pcm_${PCM_SAMPLE_RATE}` : "mp3_44100_128";
  const response = await fetch(
    `${ELEVENLABS_TTS_URL}/${voice}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": getElevenLabsKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
      }),
    },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS error (${response.status}): ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// --- WAV building (ElevenLabs pcm_* output is headerless 16-bit mono PCM) ---

function buildWav(pcmParts: Buffer[]): Buffer {
  const pcm = Buffer.concat(pcmParts);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = PCM_SAMPLE_RATE * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function concatAudio(buffers: Buffer[], format: "mp3" | "wav"): Buffer {
  if (format === "wav") return buildWav(buffers);
  return Buffer.concat(buffers); // MP3 frames concatenate cleanly
}

// --- Multi-speaker segmentation via LLM ---

interface SpeakerSegment {
  speaker: string;
  text: string;
}

async function segmentSpeakers(
  text: string,
  speakers: SpeakerConfig[],
  instructions: string,
): Promise<SpeakerSegment[]> {
  const speakerNames = speakers.map((s) => s.name);
  const systemPrompt = `You split a manuscript into voice-acting segments. The available speakers are: ${speakerNames.join(", ")}.

The user's casting instructions describe who says what:
${instructions || "(no additional instructions — infer speaker turns from the text itself, e.g. dialogue attribution, name labels, or alternating turns)"}

Rules:
1. Preserve the manuscript text VERBATIM — do not rewrite, summarize, or omit anything. Every word of the input must appear in exactly one segment, in the original order.
2. You may strip speaker-name labels (e.g. "FREUD:") from the start of a line when the label merely marks who is speaking.
3. Assign each segment to exactly one of the available speakers (use exact names from the list). Narration or unattributed text goes to the speaker the instructions designate as narrator, or the first speaker if unspecified.
4. Keep segments in original document order. Merge consecutive text by the same speaker into one segment.

Respond with JSON: {"segments": [{"speaker": "<name>", "text": "<verbatim text>"}]}`;

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Speaker segmentation failed (${response.status}): ${errText.slice(0, 300)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Speaker segmentation returned no content");

  let parsed: { segments?: SpeakerSegment[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Speaker segmentation returned invalid JSON");
  }
  const segments = (parsed.segments || []).filter(
    (s) => s && typeof s.text === "string" && s.text.trim().length > 0,
  );
  if (segments.length === 0) throw new Error("Speaker segmentation produced no segments");
  return segments;
}

// --- Public API ---

export async function generateAudio(req: TtsRequest): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const format = req.format === "wav" ? "wav" : "mp3";
  const mime = format === "wav" ? "audio/wav" : "audio/mpeg";

  if (req.mode === "multi") {
    const speakers = (req.speakers || []).filter((s) => s.name.trim());
    if (speakers.length < 2) throw new Error("Multi-voice mode requires at least 2 named speakers");

    const voiceByName = new Map<string, TtsVoice>();
    for (const s of speakers) {
      voiceByName.set(s.name.trim().toLowerCase(), s.voice);
    }
    const fallbackVoice = speakers[0].voice;

    const segments = await segmentSpeakers(req.text, speakers, req.instructions || "");

    const buffers: Buffer[] = [];
    for (const segment of segments) {
      const voice = voiceByName.get(segment.speaker.trim().toLowerCase()) || fallbackVoice;
      for (const chunk of chunkText(segment.text)) {
        buffers.push(await synthesizeChunk(chunk, voice, format));
      }
    }
    return { buffer: concatAudio(buffers, format), mime, ext: format };
  }

  const voice = req.voice && (TTS_VOICES as readonly string[]).includes(req.voice) ? req.voice : TTS_VOICES[0];
  const buffers: Buffer[] = [];
  for (const chunk of chunkText(req.text)) {
    buffers.push(await synthesizeChunk(chunk, voice, format));
  }
  return { buffer: concatAudio(buffers, format), mime, ext: format };
}
