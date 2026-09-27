import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  ShieldCheck,
  Stethoscope,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { diagnosticThinkers } from "@/data/diagnosticThinkers";
import {
  checkMultiPartRewrite, checkPresets, checkStripePublic, checkTts, checkUpload,
  type CheckEvidence,
} from "@/lib/workshopDiagnosticChecks";

type DiagnosticStatus = "waiting" | "running" | "passed" | "failed" | "unverified";

type DiagnosticResult = {
  id: string;
  label: string;
  description: string;
  status: DiagnosticStatus;
  durationMs?: number;
  httpStatus?: number;
  evidence?: string;
  error?: string;
};

type RewriteResult = {
  number: number;
  prompt: string;
  status: DiagnosticStatus;
  words?: number;
  durationMs?: number;
  provider?: string;
  output?: string;
  error?: string;
};

const PROVIDERS = [
  ["gemini", "Gemini"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["grok", "Grok"],
  ["perplexity", "Perplexity"],
  ["deepseek", "DeepSeek"],
  ["venice", "Venice AI"],
] as const;

function labelForProvider(provider: string) {
  return PROVIDERS.find(([id]) => id === provider)?.[1] || provider;
}

const INITIAL_RESULTS: DiagnosticResult[] = [
  ...PROVIDERS.map(([id, label]) => ({
    id,
    label: `${label} rewrite and API key`,
    description: `Rewrites a real Box A sample with Box C instructions and Box D style and content samples; requires ${label} itself, not a fallback provider.`,
    status: "waiting" as const,
  })),
  {
    id: "gptzero",
    label: "Automatic GPTZero detection",
    description: "Submits a real workshop-length sample and verifies that GPTZero returns a classification.",
    status: "waiting",
  },
  { id: "score-guided", label: "Box B score-guided Rewrite", description: "Scans a draft, rewrites it using the returned GPTZero feedback, and scans the new draft. A lower score is not guaranteed.", status: "waiting" },
  { id: "source-upload", label: "Box A PDF upload", description: "Uploads and reads a real diagnostic PDF.", status: "waiting" },
  { id: "style-upload", label: "Box D PDF style upload", description: "Uploads the same PDF through the separate style-sample parser.", status: "waiting" },
  { id: "presets", label: "Box C style presets", description: "Checks all 50 selectable instructions and the rewrite API's instruction limit.", status: "waiting" },
  { id: "multi-part", label: "Large-document part-by-part rewrite", description: "Checks complete text splitting, then rewrites every part through the real route in order. This is a small live smoke test, not a two-million-character run.", status: "waiting" },
  { id: "tts", label: "ElevenLabs audio and API key", description: "Generates a short real audio clip; does not just check whether a key is present.", status: "waiting" },
  { id: "stripe-public", label: "Stripe public configuration", description: "Checks that a publishable key is available; does not validate Stripe secret credentials.", status: "waiting" },
  { id: "stripe-secret", label: "Stripe secret and webhook credentials", description: "A safe live credential probe does not exist on the running server; payment and webhook operations are not triggered by diagnostics.", status: "unverified" },
  { id: "genius-generic", label: "Generic GENIUS_API_KEY", description: "The supported thinker routes use their own named keys. No running route uses the generic fallback key for a supported thinker, so it cannot be marked verified.", status: "unverified" },
  ...diagnosticThinkers.map((thinker) => ({
    id: `thinker:${thinker}`, label: `${thinker} corpus API key`,
    description: "Makes a real corpus search with this thinker's own credential; configuration alone cannot pass.",
    status: "waiting" as const,
  })),
];

function diagnosticVisitorId() {
  const key = "humanizer-workshop-diagnostic-visitor-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = `diagnostic-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

export default function HumanizerDiagnostics() {
  const [results, setResults] = useState<DiagnosticResult[]>(INITIAL_RESULTS);
  const [isRunning, setIsRunning] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const [rewriteResults, setRewriteResults] = useState<RewriteResult[]>([]);
  const [rewriteRunning, setRewriteRunning] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const rewriteController = useRef<AbortController | null>(null);

  const runHumanizerDiagnostic = async (sharedController?: AbortController) => {
    if (rewriteController.current) return;
    const controller = sharedController || new AbortController();
    rewriteController.current = controller;
    setRewriteRunning(true);
    setRewriteError("");
    setRewriteResults([]);
    try {
      const fixtureResponse = await fetch("/api/humanizer/diagnostic-prompts", {
        credentials: "include",
        signal: controller.signal,
      });
      if (!fixtureResponse.headers.get("content-type")?.includes("application/json")) {
        throw new Error("The server returned a webpage instead of diagnostic data. The new server route is not active.");
      }
      const fixture = await fixtureResponse.json();
      if (!fixtureResponse.ok) throw new Error(fixture?.error || `HTTP ${fixtureResponse.status}`);
      if (
        !Array.isArray(fixture?.prompts) ||
        fixture.prompts.length < 10
      ) {
        throw new Error("The diagnostic files are incomplete.");
      }
      const offset = Number(window.localStorage.getItem("humanizer-diagnostic-next-prompt") || 0);
      const start = Number.isFinite(offset) ? offset % fixture.prompts.length : 0;
      const cases: RewriteResult[] = Array.from({ length: 10 }, (_, index) => {
        const number = (start + index) % fixture.prompts.length;
        return { number: number + 1, prompt: fixture.prompts[number], status: "waiting" };
      });
      window.localStorage.setItem("humanizer-diagnostic-next-prompt", String((start + 10) % fixture.prompts.length));
      setRewriteResults(cases);
      for (const testCase of cases) {
        if (controller.signal.aborted) break;
        const started = performance.now();
        setRewriteResults((current) => current.map((item) =>
          item.number === testCase.number ? { ...item, status: "running" } : item,
        ));
        try {
          const response = await fetch("/api/humanizer/diagnostic-rewrite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal: controller.signal,
            body: JSON.stringify({ promptIndex: testCase.number - 1 }),
          });
          if (!response.headers.get("content-type")?.includes("application/json")) {
            throw new Error("The server returned a webpage instead of a rewrite. The new server route is not active.");
          }
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
          if (typeof payload?.text !== "string" || !payload.text.trim()) {
            throw new Error("No transformed text was returned.");
          }
          const output = payload.text.trim();
          const words = output.split(/\s+/).length;
          const sourceTerms = ["document", "chunk", "coherence", "tractatus"];
          const retained = sourceTerms.filter((term) => output.toLowerCase().includes(term)).length;
          const styleBleed = /\bnatural law\b|\bslavery\b|\blegal positivism\b|\btorture\b/i.test(output);
           const error = payload.provider !== "gemini"
             ? `Gemini did not perform this transformation; ${payload.provider || "another provider"} was substituted. ${payload.fallbackReason || ""}`
             : words < 480 || words > 720
             ? `Length check failed: ${words} words, expected approximately 600 (480–720 accepted).`
            : styleBleed
              ? "Source-fidelity check failed: the rewrite imported natural-law content not present in Box A."
            : retained < 2
              ? "Source-fidelity check failed: the rewrite does not retain at least two central Box A terms (document, chunk, coherence, tractatus)."
              : undefined;
          setRewriteResults((current) => current.map((item) =>
            item.number === testCase.number ? {
              ...item, status: error ? "failed" : "passed", words,
              durationMs: Math.round(performance.now() - started),
              provider: String(payload.provider || "unknown"), output, error,
            } : item,
          ));
        } catch (error: any) {
          setRewriteResults((current) => current.map((item) =>
            item.number === testCase.number ? {
              ...item, status: "failed",
              durationMs: Math.round(performance.now() - started),
              error: error?.name === "AbortError" ? "Stopped." : error?.message || "Rewrite failed.",
            } : item,
          ));
          if (controller.signal.aborted) break;
        }
      }
    } catch (error: any) {
      if (error?.name !== "AbortError") setRewriteError(error?.message || "Diagnostic failed.");
    } finally {
      if (rewriteController.current === controller) rewriteController.current = null;
      setRewriteRunning(false);
    }
  };

  const updateResult = (id: string, patch: Partial<DiagnosticResult>) => {
    setResults((current) =>
      current.map((result) => (result.id === id ? { ...result, ...patch } : result)),
    );
  };

  const runProviderCheck = async (
    provider: (typeof PROVIDERS)[number][0],
    signal: AbortSignal,
  ) => {
    const startedAt = performance.now();
    updateResult(provider, {
      status: "running",
      durationMs: undefined,
      httpStatus: undefined,
      evidence: undefined,
      error: undefined,
    });
    try {
      const response = await fetch("/api/humanizer/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify({
          text: "The archive records each document in the order it arrived. Readers compare the records to identify changes in the account, while retaining the source's context and chronology.",
          provider,
          instructions: "Rewrite this passage naturally. Keep its subject, concrete facts, and approximate length.",
          styleSample: "A garden survives when its soil is tended patiently. Its early growth is modest, but the seasons reward attention.",
          styleInstructions: "Use the sample's measured cadence, not its topic.",
          contentSample: "An archive can show how records changed over time.",
          contentInstructions: "Do not add facts from this sample to the source.",
        }),
      });
      const payload = await response.json().catch(() => null);
      const durationMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        throw Object.assign(
          new Error(payload?.error || `Request failed with HTTP ${response.status}`),
          { httpStatus: response.status, durationMs },
        );
      }
      if (typeof payload?.text !== "string" || !payload.text.trim()) {
        throw Object.assign(new Error("The provider returned no generated text"), {
          httpStatus: response.status,
          durationMs,
        });
      }
      if (payload.provider !== provider) {
        throw Object.assign(
          new Error(`${labelForProvider(provider)} did not pass: ${payload.provider || "another provider"} answered instead. ${payload.fallbackReason || ""}`),
          { httpStatus: response.status, durationMs },
        );
      }
      if (!/\b(archive|record|records|document|documents)\b/i.test(payload.text) ||
          /\b(garden|soil|seasons)\b/i.test(payload.text)) {
        throw Object.assign(new Error("Source-fidelity check failed: the rewrite lost the archive subject or imported the style sample's garden subject."), {
          httpStatus: response.status, durationMs,
        });
      }
      updateResult(provider, {
        status: "passed",
        durationMs,
        httpStatus: response.status,
        evidence: payload.text.trim(),
      });
      return payload.text.trim();
    } catch (error: any) {
      const durationMs = error?.durationMs || Math.round(performance.now() - startedAt);
      updateResult(provider, {
        status: "failed",
        durationMs,
        httpStatus: error?.httpStatus,
        error: error?.name === "AbortError" ? "Diagnostic stopped" : error?.message || "Request failed",
      });
      return "";
    }
  };

  const runGptZeroCheck = async (sample: string, signal: AbortSignal) => {
    const startedAt = performance.now();
    updateResult("gptzero", {
      status: "running",
      durationMs: undefined,
      httpStatus: undefined,
      evidence: undefined,
      error: undefined,
    });
    const diagnosticSample =
      sample.length >= 50
        ? sample
        : "Furthermore, it is important to recognize that technological progress offers numerous significant benefits while also presenting several complex challenges for modern society.";
    try {
      const response = await fetch("/api/gptzero/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify({
          text: `${diagnosticSample.slice(0, 2_000)} Diagnostic run ${crypto.randomUUID()}.`,
          visitorId: diagnosticVisitorId(),
        }),
      });
      const payload = await response.json().catch(() => null);
      const durationMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        throw Object.assign(
          new Error(payload?.error || `Request failed with HTTP ${response.status}`),
          { httpStatus: response.status, durationMs },
        );
      }
      const classification = payload?.documentClassification || payload?.predictedClass;
      if (typeof classification !== "string" || !classification) {
        throw Object.assign(new Error("GPTZero returned no classification"), {
          httpStatus: response.status,
          durationMs,
        });
      }
      updateResult("gptzero", {
        status: "passed",
        durationMs,
        httpStatus: response.status,
        evidence: `${classification.replaceAll("_", " ")}${
          payload?.confidenceCategory ? ` · ${payload.confidenceCategory} confidence` : ""
        }`,
      });
    } catch (error: any) {
      updateResult("gptzero", {
        status: "failed",
        durationMs: error?.durationMs || Math.round(performance.now() - startedAt),
        httpStatus: error?.httpStatus,
        error: error?.name === "AbortError" ? "Diagnostic stopped" : error?.message || "Request failed",
      });
    }
  };

  const runCheck = async (id: string, check: (signal: AbortSignal) => Promise<CheckEvidence> | CheckEvidence, signal: AbortSignal) => {
    const started = performance.now();
    updateResult(id, { status: "running", error: undefined, evidence: undefined, durationMs: undefined, httpStatus: undefined });
    try {
      const result = await check(signal);
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      updateResult(id, {
        ...result,
        status: result.degradedReason ? "failed" : "passed",
        error: result.degradedReason,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error: any) {
      updateResult(id, {
        status: "failed", durationMs: Math.round(performance.now() - started),
        httpStatus: error?.httpStatus,
        error: error?.name === "AbortError" ? "Stopped before verification." : error?.message || "Verification failed.",
      });
    }
  };

  const runThinkerCheck = (thinker: string, signal: AbortSignal) =>
    runCheck(`thinker:${thinker}`, async () => {
      const response = await fetch(`/api/thinker-chat/corpus-status?thinker=${encodeURIComponent(thinker)}&test=true`, {
        credentials: "include", signal,
      });
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object" || typeof payload.credential?.name !== "string") {
        throw Object.assign(new Error(`Corpus status did not return credential evidence (HTTP ${response.status}).`), { httpStatus: response.status });
      }
      if (!response.ok || !payload.credential.configured || !payload.configuration?.ready || !payload.access?.ok) {
        throw Object.assign(new Error(
          `${payload.credential.name}: ${payload.configuration?.missing?.length ? `Missing ${payload.configuration.missing.join(", ")}` : payload.access?.message || "Corpus search failed"}`,
        ), { httpStatus: response.status });
      }
      return {
        evidence: `${payload.credential.name}: ${payload.access.message}; ${payload.access.passageCount} passage(s).`,
        httpStatus: response.status,
      };
    }, signal);

  const runScoreGuidedCheck = (source: string, signal: AbortSignal) =>
    runCheck("score-guided", async () => {
      if (source.length < 50) throw new Error("No provider returned a usable Box B draft to test.");
      const scan = async (text: string) => {
        const response = await fetch("/api/gptzero/detect", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", signal,
          body: JSON.stringify({ text: `${text.slice(0, 2_000)} Diagnostic run ${crypto.randomUUID()}.`, visitorId: diagnosticVisitorId() }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.documentClassification) {
          throw Object.assign(new Error(payload?.error || `GPTZero did not classify the draft (HTTP ${response.status}).`), { httpStatus: response.status });
        }
        return payload;
      };
      const before = await scan(source);
      const response = await fetch("/api/humanizer/rewrite", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", signal,
        body: JSON.stringify({
          text: source, provider: "gemini",
          instructions: `Revise this Box B draft using its GPTZero classification ${before.documentClassification}. Preserve its archive subject, facts, and approximate length. Improve natural variation; do not claim any score is guaranteed.`,
        }),
      });
      const rewrite = await response.json().catch(() => null);
      if (!response.ok || typeof rewrite?.text !== "string" || !rewrite.text.trim()) {
        throw Object.assign(new Error(rewrite?.error || `Box B rewrite failed (HTTP ${response.status}).`), { httpStatus: response.status });
      }
      const after = await scan(rewrite.text);
      return {
        evidence: `Original classification: ${before.documentClassification}. Rewritten: ${rewrite.text.trim()} New classification: ${after.documentClassification}. No lower-score claim is made.`,
        httpStatus: response.status,
        degradedReason: rewrite.provider !== "gemini"
          ? `Gemini did not perform Box B Rewrite; ${rewrite.provider || "another provider"} was substituted. ${rewrite.fallbackReason || ""}`
          : undefined,
      };
    }, signal);

  const runAll = async () => {
    if (isRunning || rewriteRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setIsRunning(true);
    setResults(INITIAL_RESULTS);
    setRewriteResults([]);
    setRewriteError("");
    try {
      const samples: string[] = [];
      for (const [provider] of PROVIDERS) {
        if (controller.signal.aborted) break;
        samples.push(await runProviderCheck(provider, controller.signal));
      }
      if (!controller.signal.aborted) await runGptZeroCheck(samples.find((sample) => sample.length >= 50) || "", controller.signal);
      if (!controller.signal.aborted) await runScoreGuidedCheck(samples.find((sample) => sample.length >= 50) || "", controller.signal);
      const checks: [string, (signal: AbortSignal) => Promise<CheckEvidence> | CheckEvidence][] = [
        ["source-upload", (signal) => checkUpload("/api/parse-file", signal)],
        ["style-upload", (signal) => checkUpload("/api/parse-style-sample", signal)],
        ["presets", () => checkPresets()],
        ["multi-part", checkMultiPartRewrite],
        ["tts", checkTts],
        ["stripe-public", checkStripePublic],
      ];
      for (const [id, check] of checks) {
        if (controller.signal.aborted) break;
        await runCheck(id, check, controller.signal);
      }
      for (let i = 0; i < diagnosticThinkers.length && !controller.signal.aborted; i += 4) {
        await Promise.all(diagnosticThinkers.slice(i, i + 4).map((thinker) => runThinkerCheck(thinker, controller.signal)));
      }
      if (!controller.signal.aborted) await runHumanizerDiagnostic(controller);
    } finally {
      setIsRunning(false);
      abortController.current = null;
    }
  };

  const stop = () => abortController.current?.abort();
  const passed = results.filter((result) => result.status === "passed").length +
    rewriteResults.filter((item) => item.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length +
    rewriteResults.filter((item) => item.status === "failed").length;
  const unverified = results.filter((result) => result.status === "unverified" || result.status === "waiting" || result.status === "running").length +
    rewriteResults.filter((item) => item.status === "waiting" || item.status === "running").length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b-4 border-cyan-600 bg-white shadow-md">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-700 text-white shadow-md">
              <Stethoscope className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-wide sm:text-2xl">
                Humanizer Diagnostics
              </h1>
              <p className="text-sm text-slate-600">
                Real provider and GPTZero requests with visible evidence.
              </p>
            </div>
          </div>
          <Link href="/humanizer-workshop">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Workshop
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-5 lg:p-8">
        <section className="rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Humanizer transformation diagnostic</h2>
          <p className="mt-1 text-sm text-slate-700">
            Uses the supplied Box A text and full Box D style sample. Each click runs 10 different supplied instructions
            through the real rewrite endpoint, requesting approximately 600 words per result. Prompts rotate through all 50.
            These instructions refer to natural law, whereas the supplied Box A text concerns document processing;
            the source-fidelity check flags results that abandon Box A.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {rewriteRunning ? (
              <Button type="button" variant="destructive" onClick={() => rewriteController.current?.abort()}>
                <StopCircle className="mr-2 h-4 w-4" /> Stop transformation diagnostic
              </Button>
            ) : (
                <Button type="button" disabled={isRunning} onClick={() => void runHumanizerDiagnostic()} className="bg-blue-700 hover:bg-blue-800" data-testid="button-humanizer-diagnostic">
                <Play className="mr-2 h-4 w-4" /> Test 10 transformations
              </Button>
            )}
            <span role="status" className="text-sm text-slate-700">
              {rewriteResults.filter((item) => item.status === "passed" || item.status === "failed").length}
              /{rewriteResults.length} completed · {rewriteResults.filter((item) => item.status === "passed").length} passed
            </span>
          </div>
          {rewriteError ? <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{rewriteError}</p> : null}
          <div className="mt-4 space-y-3">
            {rewriteResults.map((item) => (
              <article key={item.number} className={`rounded-lg border p-4 ${item.status === "passed" ? "border-emerald-300" : item.status === "failed" ? "border-red-300" : "border-slate-200"}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-bold">Prompt {item.number} · {item.status}</h3>
                  <span className="text-xs text-slate-600">
                    {item.words !== undefined ? `${item.words} words · ` : ""}
                    {item.provider ? `${item.provider} · ` : ""}
                    {item.durationMs !== undefined ? `${item.durationMs.toLocaleString()} ms` : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm">{item.prompt}</p>
                {item.error ? <p role="alert" className="mt-2 text-sm text-red-700">{item.error}</p> : null}
                {item.output ? (
                  <details className="mt-3 rounded border bg-slate-50 p-3">
                    <summary className="cursor-pointer font-semibold">Inspect full transformed text</summary>
                    <div className="mt-3 whitespace-pre-wrap font-serif text-sm leading-relaxed">{item.output}</div>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Live system check</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                This sends real rewrite, parser, detection, audio, and corpus requests. It runs the 10 transformation cases afterward.
                It may take several minutes and consume paid API usage. Green means a real result was verified; fallback providers do not pass for the requested key.
              </p>
            </div>
            {isRunning ? (
              <Button type="button" variant="destructive" onClick={stop} className="gap-2">
                <StopCircle className="h-4 w-4" /> Stop diagnostics
              </Button>
            ) : (
              <Button type="button" onClick={() => void runAll()} className="gap-2 bg-cyan-700 hover:bg-cyan-800">
                <Play className="h-4 w-4" /> Run all diagnostics
              </Button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <span className="rounded-full bg-slate-100 px-3 py-1">{results.length + rewriteResults.length} checks listed</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{passed} passed</span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">{failed} failed</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{unverified} not verified</span>
          </div>
          {isRunning ? <p role="status" className="mt-3 text-sm font-semibold text-blue-800">Diagnostics running. Results update as each real request completes.</p> : null}
          {!isRunning && (passed > 0 || failed > 0) ? (
            <p role="status" className={`mt-3 text-sm font-semibold ${failed || unverified || rewriteError ? "text-red-800" : "text-emerald-800"}`}>
              {failed || unverified || rewriteError
                ? "Not all functions and credentials are verified. Review failed and unverified checks before relying on the app."
                : "All listed live checks passed."}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-amber-900">
            Stripe secret and webhook keys cannot be tested safely through the current running server. Clear All, browser reload recovery,
            a complete two-million-character run, payments, and unrelated Text Surgeon tools are not verified by this workshop suite.
            No untested function is counted as passed.
          </p>
        </section>

        <section className="space-y-3">
          {results.filter((result) => !result.id.startsWith("thinker:")).map((result) => {
            const styles =
              result.status === "passed"
                ? "border-emerald-300 bg-emerald-50"
                : result.status === "failed"
                  ? "border-red-300 bg-red-50"
                    : result.status === "unverified"
                      ? "border-amber-300 bg-amber-50"
                    : result.status === "running"
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white";
            const Icon =
              result.status === "passed"
                ? CheckCircle2
                : result.status === "failed"
                  ? AlertCircle
                  : result.status === "running"
                    ? Loader2
                    : Circle;
            return (
              <article key={result.id} className={`rounded-xl border p-4 shadow-sm ${styles}`}>
                <div className="flex items-start gap-3">
                  <Icon
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      result.status === "running" ? "animate-spin text-blue-700" : ""
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-black">{result.label}</h3>
                      <div className="flex gap-2 text-xs font-semibold text-slate-600">
                        {result.httpStatus ? <span>HTTP {result.httpStatus}</span> : null}
                        {result.durationMs !== undefined ? <span>{result.durationMs.toLocaleString()} ms</span> : null}
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{result.description}</p>
                    {result.evidence ? (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-white p-3 text-sm">
                        <div className="mb-1 flex items-center gap-1 font-bold text-emerald-800">
                          <ShieldCheck className="h-4 w-4" /> Verified output
                        </div>
                        <p className="break-words font-serif">{result.evidence}</p>
                      </div>
                    ) : null}
                    {result.error ? (
                      <div className="mt-3 rounded-md border border-red-200 bg-white p-3 text-sm text-red-800">
                        {result.error}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
        <details className="rounded-xl border bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-bold">
            Individual thinker corpus credentials ({results.filter((result) => result.id.startsWith("thinker:") && result.status === "passed").length}/{diagnosticThinkers.length} verified)
          </summary>
          <div className="mt-3 space-y-2">
            {results.filter((result) => result.id.startsWith("thinker:")).map((result) => (
              <div key={result.id} className={`rounded border p-3 text-sm ${result.status === "passed" ? "border-emerald-200 bg-emerald-50" : result.status === "failed" ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                <span className="font-bold">{result.label}: {result.status}</span>
                {result.httpStatus ? ` · HTTP ${result.httpStatus}` : ""}
                {result.durationMs !== undefined ? ` · ${result.durationMs.toLocaleString()} ms` : ""}
                {result.evidence ? <p className="mt-1 break-words">{result.evidence}</p> : null}
                {result.error ? <p className="mt-1 break-words text-red-800">{result.error}</p> : null}
              </div>
            ))}
          </div>
        </details>
      </main>
    </div>
  );
}