import { callLLM } from "../../llm";
import {
  CoherenceState,
  CoherenceModeType,
  ChunkEvaluationResult,
  ProgressUpdate,
  ProcessingResult
} from "./stateSchemas";
import {
  generateDocumentId,
  createInitialState,
  initializeCoherenceRun,
  readCoherenceState,
  updateCoherenceState,
  writeChunkEvaluation,
  applyStateUpdate,
  checkViolations,
  markDocumentComplete,
  markDocumentFailed
} from "./coherenceDatabase";

// Retry wrapper with timeout for LLM calls
async function callLLMWithRetry(
  provider: string,
  prompt: string,
  maxRetries: number = 3,
  timeoutMs: number = 120000
): Promise<string> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const result = await Promise.race([
        callLLM(provider, prompt),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`LLM call timed out after ${timeoutMs}ms`));
          });
        })
      ]);
      
      clearTimeout(timeoutId);
      return result;
    } catch (error: any) {
      lastError = error;
      const isRetryable = 
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('timed out') ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('network') ||
        error.cause?.code === 'ECONNRESET';
      
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`LLM call failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (!isRetryable) {
        throw error;
      }
    }
  }
  
  throw lastError || new Error("LLM call failed after all retries");
}

export function chunkText(text: string, maxWords: number = 1000): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    const chunkWords = words.slice(i, Math.min(i + maxWords, words.length));
    chunks.push(chunkWords.join(' '));
  }

  return chunks;
}

export interface CoherenceSection {
  text: string;
  chapterNumber?: number;
  title?: string;
}

interface WorkChunk {
  text: string;
  chapterNumber?: number;
  chapterTitle?: string;
  chapterChunkIndex: number;
  chapterChunkCount: number;
}

export function buildWorkChunks(text: string, sections?: CoherenceSection[], maxWords = 1000): WorkChunk[] {
  if (!sections?.length) {
    const chunks = chunkText(text, maxWords);
    return chunks.map((chunk, index) => ({
      text: chunk,
      chapterChunkIndex: index,
      chapterChunkCount: chunks.length
    }));
  }

  return sections.flatMap((section) => {
    const chunks = chunkText(section.text, maxWords);
    return chunks.map((chunk, index) => ({
      text: chunk,
      chapterNumber: section.chapterNumber,
      chapterTitle: section.title,
      chapterChunkIndex: index,
      chapterChunkCount: chunks.length
    }));
  });
}

/** A Tractatus rewrite is all propositions: never headings, commentary, or copied prose. */
export function validateTractatusOutput(value: unknown, expectedChapter?: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("The model returned no Tractatus propositions");
  }

  const lines = value.replace(/```(?:text|markdown)?/gi, "").replace(/```/g, "")
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const proposition = /^[•*-]?\s*(\d+)(?:\.(?:\d+))*\.?\s+\S/;
  for (const line of lines) {
    const match = proposition.exec(line);
    if (!match) throw new Error(`Non-proposition text in Tractatus output: ${line.slice(0, 80)}`);
    if (expectedChapter !== undefined && Number(match[1]) !== expectedChapter) {
      throw new Error(`Expected chapter ${expectedChapter} proposition, received chapter ${match[1]}`);
    }
  }
  return lines.join("\n");
}

function parseJsonResponse(response: string): any {
  const unfenced = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error("The model did not return a JSON object");
  }
}

export async function autoDetectMode(firstChunk: string, provider: string): Promise<CoherenceModeType> {
  const prompt = `Analyze this text and determine its primary coherence mode.

TEXT:
${firstChunk.substring(0, 2000)}

MODES:
1. logical-consistency - Tracks factual assertions to prevent contradictions
2. logical-cohesiveness - Tracks argument structure (thesis, support, objections)
3. scientific-explanatory - Tracks causal relationships and mechanisms
4. thematic-psychological - Tracks emotional tone, affect, narrative stance
5. instructional - Tracks goals, steps, prerequisites
6. motivational - Tracks direction, intensity, target of persuasion
7. mathematical - Tracks givens, lemmas, proof methods
8. philosophical - Tracks concepts, distinctions, dialectical moves

Return ONLY the mode name (e.g., "logical-cohesiveness"), nothing else.`;

  const response = await callLLMWithRetry(provider, prompt);
  const mode = response.trim().toLowerCase().replace(/[^a-z-]/g, '') as CoherenceModeType;
  
  const validModes: CoherenceModeType[] = [
    "logical-consistency", "logical-cohesiveness", "scientific-explanatory",
    "thematic-psychological", "instructional", "motivational", "mathematical", "philosophical"
  ];
  
  return validModes.includes(mode) ? mode : "logical-cohesiveness";
}

function formatStateForPrompt(mode: CoherenceModeType, state: CoherenceState): string {
  const s = state as any;
  
  switch (mode) {
    case "logical-cohesiveness":
      return `Thesis: ${s.thesis || "(not yet established)"}
Current stage: ${s.current_stage}
Key terms defined: ${Object.keys(s.key_terms || {}).join(", ") || "(none)"}
Assertions made: ${(s.assertions_made || []).slice(-10).join("; ") || "(none)"}
Support queue (claims needing backing): ${(s.support_queue || []).join("; ") || "(none)"}
Bridge required: ${s.bridge_required || "(none)"}`;

    case "logical-consistency":
      return `Assertions established as true: ${(s.assertions || []).slice(-15).join("; ") || "(none)"}
Negations (claims denied): ${(s.negations || []).slice(-10).join("; ") || "(none)"}
Mutually exclusive pairs: ${(s.disjoint_pairs || []).map((p: string[]) => `(${p[0]} vs ${p[1]})`).join("; ") || "(none)"}`;

    case "philosophical":
      return `Core concepts: ${Object.entries(s.core_concepts || {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none)"}
Distinctions: ${(s.distinctions || []).map((d: string[]) => `${d[0]} vs ${d[1]}`).join("; ") || "(none)"}
Dialectic: Thesis: ${s.dialectic?.thesis || "?"}, Antithesis: ${s.dialectic?.antithesis || "?"}, Synthesis: ${s.dialectic?.synthesis || "?"}
Objections raised: ${(s.objections_raised || []).join("; ") || "(none)"}
Objections answered: ${(s.objections_answered || []).join("; ") || "(none)"}`;

    default:
      return JSON.stringify(state, null, 2);
  }
}

export async function extractInitialState(
  mode: CoherenceModeType,
  firstChunk: string,
  provider: string
): Promise<CoherenceState> {
  const baseState = createInitialState(mode);

  const prompt = `Extract the initial coherence state from this opening text.

MODE: ${mode}
TEXT:
${firstChunk}

Based on the mode "${mode}", extract the initial state elements. Return JSON matching this structure:
${JSON.stringify(baseState, null, 2)}

Fill in what you can determine from the text. For thesis/goal, extract the main claim or purpose. For key_terms, extract any definitions. Return valid JSON only.`;

  try {
    const response = await callLLMWithRetry(provider, prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      const updatedState = applyStateUpdate(baseState, extracted);
      if (mode === "philosophical") {
        (updatedState as any).lastChapterNumber = 0;
      }
      return updatedState;
    }
  } catch (e) {
    console.error("Failed to extract initial state:", e);
  }

  return baseState;
}

async function processChunk(
  mode: CoherenceModeType,
  state: CoherenceState,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  provider: string,
  taskType: "rewrite" | "evaluate",
  instructions?: string,
  workChunk?: WorkChunk,
  previousTractatusOutput?: string
): Promise<{ output: string; evaluation: ChunkEvaluationResult }> {
  const stateDescription = formatStateForPrompt(mode, state);

  let prompt: string;
  
  const lastChapterNum = (state as any).lastChapterNumber ?? 0;
  const fixedChapter = workChunk?.chapterNumber;
  const nextChapter = fixedChapter ?? (chunkIndex === 0 ? 1 : lastChapterNum + 1);
  const isTractatus = instructions?.includes("Tractatus") || instructions?.includes("Wittgenstein");
  
  if (taskType === "rewrite") {
    const chapterInstruction = isTractatus && fixedChapter !== undefined ? `
CRITICAL SOURCE-CHAPTER NUMBERING RULES (MUST FOLLOW):
- This material is from source chapter ${fixedChapter}${workChunk?.chapterTitle ? ` (${workChunk.chapterTitle})` : ""}.
- EVERY proposition in this response must begin with ${fixedChapter}. No other leading chapter number is allowed.
- This is part ${(workChunk?.chapterChunkIndex ?? 0) + 1} of ${workChunk?.chapterChunkCount ?? 1} for source chapter ${fixedChapter}.
${workChunk?.chapterChunkIndex === 0
  ? `- Begin the chapter with ${fixedChapter}. and its subordinate propositions.`
  : `- Continue the existing chapter hierarchy. Do not restart with a duplicate ${fixedChapter}. proposition.`}
${previousTractatusOutput ? `- The previous propositions ended as follows; continue without duplicating their numbers:\n${previousTractatusOutput}` : ""}
- Include "lastChapterNumber": ${fixedChapter} in state_update.
` : isTractatus ? `
CRITICAL NUMBERING RULES (MUST FOLLOW):
- This is chunk ${chunkIndex + 1} of the document
${chunkIndex === 0 ? `- THIS IS THE FIRST CHUNK - START NUMBERING AT 1. (not any other number)` : `- The previous chunk ended at chapter ${lastChapterNum}`}
- Start this chunk with ${nextChapter}. and continue (${nextChapter}.1, ${nextChapter}.11, etc.)
- If multiple themes exist in this chunk, use ${nextChapter}., ${nextChapter + 1}., etc.
- NEVER use any number lower than ${nextChapter} for chapter headings
- Include "lastChapterNumber" in state_update with the highest chapter number used
` : "";
    
    prompt = `You are rewriting a document chunk-by-chunk while maintaining coherence.

COHERENCE MODE: ${mode}

CURRENT ACCUMULATED STATE:
${stateDescription}
${chapterInstruction}
CHUNK ${chunkIndex + 1} OF ${totalChunks}:
${chunk}

${instructions ? `REWRITE INSTRUCTIONS: ${instructions}` : ""}

TASK:
1. Rewrite this chunk according to the instructions
2. Maintain coherence with the accumulated state
3. Do not contradict prior assertions
4. Continue the established thesis and argument structure

Return JSON:
{
  "rewritten_text": "Your rewritten chunk here",
  "state_update": {
    "assertions_made": ["new assertions in this chunk"],
    "key_terms": {"new_term": "definition if any"}${isTractatus ? ',\n    "lastChapterNumber": <highest chapter number used in this chunk>' : ''}
  }
}`;
  } else {
    prompt = `Evaluate this chunk against the accumulated coherence state.

COHERENCE MODE: ${mode}

CURRENT ACCUMULATED STATE:
${stateDescription}

CHUNK ${chunkIndex + 1} OF ${totalChunks}:
${chunk}

Return JSON:
{
  "status": "preserved" | "weakened" | "broken",
  "violations": [{ "type": "contradiction|drift|repetition", "description": "..." }],
  "repairs": [{ "location": "...", "suggestion": "..." }],
  "state_update": { ... }
}`;
  }

  let lastParseError: Error | undefined;
  for (let formatAttempt = 1; formatAttempt <= 3; formatAttempt++) {
    const repairInstruction = formatAttempt === 1 ? "" : `

YOUR PREVIOUS RESPONSE COULD NOT BE USED: ${lastParseError?.message || "invalid format"}.
Return one valid JSON object only. JSON-escape all newlines in rewritten_text. Do not include markdown fences or commentary.`;
    const response = await callLLMWithRetry(provider, prompt + repairInstruction);
    try {
      const result = parseJsonResponse(response);
      
      if (taskType === "rewrite") {
        const stateUpdate = result.state_update || {};
        let rewrittenText = result.rewritten_text;

        if (isTractatus) {
          rewrittenText = validateTractatusOutput(rewrittenText, fixedChapter);
        } else if (typeof rewrittenText !== "string" || !rewrittenText.trim()) {
          throw new Error("The model returned no rewritten_text");
        }
        
        if (isTractatus) {
          const chapterMatches = rewrittenText.match(/^\s*[•\-*]*\s*(\d+)\./gm);
          if (chapterMatches) {
            const chapters = chapterMatches.map((m: string) => {
              const match = m.match(/(\d+)\./);
              return match ? parseInt(match[1]) : 0;
            }).filter((n: number) => n > 0);
            if (chapters.length > 0) {
              const extractedMax = Math.max(...chapters);
              stateUpdate.lastChapterNumber = Math.max(extractedMax, stateUpdate.lastChapterNumber || 0);
            }
          }
        }
        
        return {
          output: rewrittenText,
          evaluation: {
            status: "preserved",
            violations: [],
            repairs: [],
            state_update: stateUpdate
          }
        };
      } else {
        return {
          output: chunk,
          evaluation: {
            status: result.status || "preserved",
            violations: result.violations || [],
            repairs: result.repairs || [],
            state_update: result.state_update || {}
          }
        };
      }
    } catch (error: any) {
      lastParseError = error instanceof Error ? error : new Error(String(error));
      console.error(`Failed to parse chunk result (format attempt ${formatAttempt}/3):`, lastParseError.message);
    }
  }

  // Never pass the input chunk through as a rewrite: that silently leaks source prose
  // into generated documents and makes an incomplete rewrite look successful.
  throw new Error(`Unable to produce a valid rewritten chunk after 3 format attempts: ${lastParseError?.message || "invalid model response"}`);
}

export async function processDocumentSequentially(
  text: string,
  mode: CoherenceModeType | "auto",
  provider: string,
  taskType: "rewrite" | "evaluate",
  instructions?: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number,
  sections?: CoherenceSection[]
): Promise<ProcessingResult> {
  const docId = generateDocumentId();
  const workChunks = buildWorkChunks(text, sections, 1000);
  const chunks = workChunks.map((chunk) => chunk.text);
  const wordCount = text.split(/\s+/).length;

  onProgress?.({ documentId: docId, phase: "detecting", message: "Detecting coherence mode..." });

  const resolvedMode = mode === "auto"
    ? await autoDetectMode(chunks[0], provider)
    : mode;

  onProgress?.({ documentId: docId, phase: "extracting", message: `Mode: ${resolvedMode}. Extracting initial state...` });

  const initialState = await extractInitialState(resolvedMode, chunks[0], provider);

  await initializeCoherenceRun(docId, resolvedMode, initialState, wordCount, chunks.length, userId);

  const chunk0Result = await processChunk(
    resolvedMode, initialState, chunks[0], 0, chunks.length, provider, taskType, instructions, workChunks[0]
  );
  await writeChunkEvaluation(docId, resolvedMode, 0, chunks[0], chunk0Result.output, chunk0Result.evaluation, initialState);

  const outputs: string[] = [chunk0Result.output];
  let currentState = applyStateUpdate(initialState, chunk0Result.evaluation.state_update);
  let previousTractatusOutput = chunk0Result.output.split("\n").slice(-12).join("\n");

  for (let i = 1; i < chunks.length; i++) {
    onProgress?.({
      documentId: docId,
      phase: "processing",
      currentChunk: i + 1,
      totalChunks: chunks.length,
      message: `Processing chunk ${i + 1} of ${chunks.length}...`
    });

    const result = await processChunk(
      resolvedMode, currentState, chunks[i], i, chunks.length, provider, taskType, instructions,
      workChunks[i], workChunks[i].chapterChunkIndex > 0 ? previousTractatusOutput : undefined
    );

    const violations = checkViolations(currentState, result.evaluation.state_update);
    if (violations.length > 0) {
      result.evaluation.violations.push(...violations);
    }

    const newState = applyStateUpdate(currentState, result.evaluation.state_update);
    await updateCoherenceState(docId, resolvedMode, newState);
    await writeChunkEvaluation(docId, resolvedMode, i, chunks[i], result.output, result.evaluation, newState);

    outputs.push(result.output);
    previousTractatusOutput = result.output.split("\n").slice(-12).join("\n");
    currentState = newState;

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  await markDocumentComplete(docId);

  onProgress?.({
    documentId: docId,
    phase: "complete",
    message: `Processing complete. ${chunks.length} chunks processed.`
  });

  return {
    documentId: docId,
    mode: resolvedMode,
    finalOutput: outputs.join('\n\n'),
    finalState: currentState,
    chunkCount: chunks.length
  };
}
