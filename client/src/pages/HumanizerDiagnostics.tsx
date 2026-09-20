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

type DiagnosticStatus = "waiting" | "running" | "passed" | "failed";

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

const PROVIDERS = [
  ["gemini", "Gemini"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["grok", "Grok"],
  ["perplexity", "Perplexity"],
  ["deepseek", "DeepSeek"],
] as const;

const INITIAL_RESULTS: DiagnosticResult[] = [
  ...PROVIDERS.map(([id, label]) => ({
    id,
    label: `${label} generation`,
    description: `Generates one real sentence through ${label}.`,
    status: "waiting" as const,
  })),
  {
    id: "gptzero",
    label: "Automatic GPTZero detection",
    description: "Submits a real workshop-length sample and verifies that GPTZero returns a classification.",
    status: "waiting",
  },
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
      const response = await fetch("/api/humanizer/generate-ai-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify({
          provider,
          lengthMode: "sentence",
          wordCount: 1,
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
          text: diagnosticSample,
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

  const runAll = async () => {
    if (isRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setIsRunning(true);
    setResults(INITIAL_RESULTS);
    try {
      const generatedSamples = await Promise.all(
        PROVIDERS.map(([provider]) => runProviderCheck(provider, controller.signal)),
      );
      if (!controller.signal.aborted) {
        await runGptZeroCheck(generatedSamples.find((sample) => sample.length >= 50) || "", controller.signal);
      }
    } finally {
      setIsRunning(false);
      abortController.current = null;
    }
  };

  const stop = () => abortController.current?.abort();
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;

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
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Live system check</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                This sends real requests. A green result means the provider returned usable output now;
                it is not a configuration-only claim.
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
            <span className="rounded-full bg-slate-100 px-3 py-1">{results.length} checks</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{passed} passed</span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">{failed} failed</span>
          </div>
        </section>

        <section className="space-y-3">
          {results.map((result) => {
            const styles =
              result.status === "passed"
                ? "border-emerald-300 bg-emerald-50"
                : result.status === "failed"
                  ? "border-red-300 bg-red-50"
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
      </main>
    </div>
  );
}