import { useEffect, useRef, useState } from "react";
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
import { DiagnosticLivePopup, type DiagnosticTrace } from "@/components/DiagnosticLivePopup";
import { diagnosticThinkers } from "@/data/diagnosticThinkers";
import { CORE_FUNCTIONS, checkCoreFunction } from "@/lib/coreFunctionDiagnostics";
import {
  READ_ONLY_DIAGNOSTIC_CASES, UNCOVERED_HIGH_IMPACT_CATEGORIES, checkReadOnlyEndpoint,
} from "@/lib/readOnlyDiagnostics";
import {
  checkStripePublic, checkTts, checkUpload,
  type CheckEvidence,
} from "@/lib/workshopDiagnosticChecks";

type DiagnosticStatus = "waiting" | "running" | "passed" | "failed" | "unverified" | "stopped";

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

function credentialForThinker(thinker: string) {
  if (thinker === "Le Bon") return "LEBON_API_KEY";
  return `${thinker.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

const INITIAL_RESULTS: DiagnosticResult[] = [
  ...CORE_FUNCTIONS.map(({ id, label }) => ({
    id: `core:${id}`, label: `Main page: ${label}`,
    description: "Runs the main-page function with a synthetic source and displays its genuine streamed response in a dedicated popup.",
    status: "waiting" as const,
  })),
  ...READ_ONLY_DIAGNOSTIC_CASES.map((testCase) => ({
    id: `read:${testCase.id}`, label: testCase.label,
    description: "Makes a real, read-only request and verifies the returned data shape without changing user records.",
    status: "waiting" as const,
  })),
  {
    id: "gptzero",
    label: "Automatic GPTZero detection",
    description: "Submits a diagnostic sample to GPTZero and verifies that a classification is returned.",
    status: "waiting",
  },
  { id: "source-upload", label: "Box A PDF upload", description: "Uploads and reads a real diagnostic PDF.", status: "waiting" },
  { id: "style-upload", label: "Box D PDF style upload", description: "Uploads the same PDF through the separate style-sample parser.", status: "waiting" },
  { id: "tts", label: "ElevenLabs audio and API key", description: "Generates a short real audio clip; does not just check whether a key is present.", status: "waiting" },
  { id: "stripe-public", label: "Stripe public configuration", description: "Checks that a publishable key is available; does not validate Stripe secret credentials.", status: "waiting" },
  { id: "stripe-secret", label: "Stripe secret and webhook credentials", description: "A safe live credential probe does not exist on the running server; payment and webhook operations are not triggered by diagnostics.", status: "unverified" },
  { id: "genius-generic", label: "Generic GENIUS_API_KEY", description: "The supported authors use their own named keys. This generic key is not used by their corpus routes and cannot be marked verified by an author-specific search.", status: "unverified" },
  ...UNCOVERED_HIGH_IMPACT_CATEGORIES.map((item, index) => ({
    id: `uncovered:${index}`, label: item.category, description: item.reason, status: "unverified" as const,
  })),
  ...diagnosticThinkers.map((thinker) => ({
    id: `thinker:${thinker}`, label: `${thinker} corpus API key`,
    description: `Makes a real corpus search using ${credentialForThinker(thinker)}; the returned credential name must match and a passage must be found.`,
    status: "waiting" as const,
  })),
];

function diagnosticVisitorId() {
  const key = "humanizer-diagnostic-visitor-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = `diagnostic-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

export default function HumanizerDiagnostics() {
  const [results, setResults] = useState<DiagnosticResult[]>(INITIAL_RESULTS);
  const [isRunning, setIsRunning] = useState(false);
  const [wasStopped, setWasStopped] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const [traces, setTraces] = useState<Record<string, DiagnosticTrace>>({});
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  useEffect(() => () => abortController.current?.abort(), []);

  const recordTrace = (id: string, label: string, status: DiagnosticTrace["status"], output?: string, error?: string) => {
    const time = new Date().toLocaleTimeString();
    setTraces((current) => {
      const previous = current[id];
      return {
        ...current,
        [id]: {
          id, label, status,
          events: status === "running"
            ? [`${time} — Started a real request. Waiting for the provider or service to respond.`]
            : [...(previous?.events || []), `${time} — ${status === "passed" ? "Passed." : status === "stopped" ? "Stopped by user; no result verified." : `Failed or unverified: ${error || "No verified result."}`}`],
          output: status === "running" ? undefined : output ?? previous?.output,
        },
      };
    });
    if (status === "running") setActiveTraceId(id);
  };

  const appendTraceStage = (id: string, message: string) => {
    setTraces((current) => {
      const trace = current[id];
      if (!trace) return current;
      return {
        ...current,
        [id]: { ...trace, events: [...trace.events, `${new Date().toLocaleTimeString()} — ${message}`] },
      };
    });
  };

  const updateResult = (id: string, patch: Partial<DiagnosticResult>) => {
    setResults((current) =>
      current.map((result) => (result.id === id ? { ...result, ...patch } : result)),
    );
    if (patch.status === "running" || patch.status === "passed" || patch.status === "failed") {
      const label = INITIAL_RESULTS.find((item) => item.id === id)?.label || id;
      recordTrace(id, label, patch.status, patch.evidence, patch.error);
    }
  };

  const appendStreamedText = (id: string, chunk: string) => {
    setTraces((current) => {
      const trace = current[id];
      if (!trace) return current;
      return { ...current, [id]: { ...trace, output: (trace.output || "") + chunk } };
    });
  };

  const runMainFunctions = async (signal: AbortSignal) => {
    for (const { id } of CORE_FUNCTIONS) {
      if (signal.aborted) break;
      const traceId = `core:${id}`;
      await runCheck(traceId, (activeSignal) =>
        checkCoreFunction(id, activeSignal, (chunk) => {
          if (!activeSignal.aborted) appendStreamedText(traceId, chunk);
        }), signal);
    }
  };

  const runReadOnlyChecks = async (signal: AbortSignal) => {
    for (const testCase of READ_ONLY_DIAGNOSTIC_CASES) {
      if (signal.aborted) break;
      await runCheck(`read:${testCase.id}`, (activeSignal) => checkReadOnlyEndpoint(testCase, activeSignal), signal);
    }
  };

  const runGptZeroCheck = async (signal: AbortSignal) => {
    if (signal.aborted) return;
    const startedAt = performance.now();
    updateResult("gptzero", {
      status: "running",
      durationMs: undefined,
      httpStatus: undefined,
      evidence: undefined,
      error: undefined,
    });
    const diagnosticSample =
      "Public libraries preserve books, local records, and community archives. Readers use these collections to compare accounts, follow changes over time, and understand how each document fits its historical context.";
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
      if (signal.aborted) return;
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
      if (signal.aborted) return;
      updateResult("gptzero", {
        status: "failed",
        durationMs: error?.durationMs || Math.round(performance.now() - startedAt),
        httpStatus: error?.httpStatus,
        error: error?.name === "AbortError" ? "Diagnostic stopped" : error?.message || "Request failed",
      });
    }
  };

  const runCheck = async (id: string, check: (signal: AbortSignal) => Promise<CheckEvidence> | CheckEvidence, signal: AbortSignal) => {
    if (signal.aborted) return;
    const started = performance.now();
    updateResult(id, { status: "running", error: undefined, evidence: undefined, durationMs: undefined, httpStatus: undefined });
    try {
      const result = await check(signal);
      if (signal.aborted) return;
      updateResult(id, {
        ...result,
        status: result.degradedReason ? "failed" : "passed",
        error: result.degradedReason,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error: any) {
      if (signal.aborted) return;
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
      const expectedCredential = credentialForThinker(thinker);
      if (payload.credential.name !== expectedCredential) {
        throw Object.assign(new Error(
          `Expected ${expectedCredential}; the server selected ${payload.credential.name}. This author's key has not been tested.`,
        ), { httpStatus: response.status });
      }
      if (!response.ok || !payload.credential.configured || !payload.configuration?.ready || !payload.access?.ok || !(payload.access.passageCount > 0)) {
        throw Object.assign(new Error(
          `${payload.credential.name}: ${payload.configuration?.missing?.length ? `Missing ${payload.configuration.missing.join(", ")}` : payload.access?.passageCount === 0 ? "No passage was returned; this author's corpus access is unverified" : payload.access?.message || "Corpus search failed"}`,
        ), { httpStatus: response.status });
      }
      return {
        evidence: `${payload.credential.name}: ${payload.access.message}; ${payload.access.passageCount} passage(s).`,
        httpStatus: response.status,
      };
    }, signal);

  const runAll = async () => {
    if (abortController.current || isRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setWasStopped(false);
    setIsRunning(true);
    setResults(INITIAL_RESULTS);
    try {
      await runMainFunctions(controller.signal);
      await runReadOnlyChecks(controller.signal);
      if (!controller.signal.aborted) await runGptZeroCheck(controller.signal);
      const checks: [string, (signal: AbortSignal) => Promise<CheckEvidence> | CheckEvidence][] = [
        ["source-upload", (signal) => checkUpload("/api/parse-file", signal)],
        ["style-upload", (signal) => checkUpload("/api/parse-style-sample", signal)],
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
    } finally {
      if (abortController.current === controller) {
        setIsRunning(false);
        abortController.current = null;
      }
    }
  };

  const runMainFunctionDiagnostics = async () => {
    if (abortController.current || isRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setWasStopped(false);
    setIsRunning(true);
    setResults((current) => current.map((result) =>
      result.id.startsWith("core:")
        ? { ...result, status: "waiting", error: undefined, evidence: undefined, httpStatus: undefined, durationMs: undefined }
        : result,
    ));
    try {
      await runMainFunctions(controller.signal);
    } finally {
      if (abortController.current === controller) {
        setIsRunning(false);
        abortController.current = null;
      }
    }
  };

  const runReadOnlyDiagnostics = async () => {
    if (abortController.current || isRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setWasStopped(false);
    setIsRunning(true);
    setResults((current) => current.map((result) =>
      result.id.startsWith("read:")
        ? { ...result, status: "waiting", error: undefined, evidence: undefined, httpStatus: undefined, durationMs: undefined }
        : result,
    ));
    try {
      await runReadOnlyChecks(controller.signal);
    } finally {
      if (abortController.current === controller) {
        setIsRunning(false);
        abortController.current = null;
      }
    }
  };

  const runAuthorKeyDiagnostics = async () => {
    if (abortController.current || isRunning) return;
    const controller = new AbortController();
    abortController.current = controller;
    setWasStopped(false);
    setIsRunning(true);
    setResults((current) => current.map((result) =>
      result.id.startsWith("thinker:")
        ? { ...result, status: "waiting", error: undefined, evidence: undefined, httpStatus: undefined, durationMs: undefined }
        : result,
    ));
    try {
      for (let i = 0; i < diagnosticThinkers.length && !controller.signal.aborted; i += 4) {
        await Promise.all(diagnosticThinkers.slice(i, i + 4).map((thinker) => runThinkerCheck(thinker, controller.signal)));
      }
    } finally {
      if (abortController.current === controller) {
        setIsRunning(false);
        abortController.current = null;
      }
    }
  };

  const stop = () => {
    const controller = abortController.current;
    if (!controller) return;
    controller.abort();
    abortController.current = null;
    setIsRunning(false);
    setWasStopped(true);
    setResults((current) => current.map((result) =>
      result.status === "running" || result.status === "waiting"
        ? { ...result, status: "stopped", error: "Stopped by user; not verified.", evidence: undefined }
        : result,
    ));
    setTraces((current) => Object.fromEntries(Object.entries(current).map(([id, trace]) =>
      [id, trace.status === "running"
        ? { ...trace, status: "stopped" as const, events: [...trace.events, `${new Date().toLocaleTimeString()} — Stopped by user. No further results will be accepted.`] }
        : trace],
    )));
  };
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const unverified = results.filter((result) => result.status === "unverified" || result.status === "waiting" || result.status === "running" || result.status === "stopped").length;

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
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm text-amber-950">
          <h2 className="text-lg font-black">Workshop checks unavailable</h2>
          <p className="mt-1 text-sm">
            Transformation, provider rewrite, style/content sample, score-guided rewrite, preset, and multipart workshop
            diagnostics are retired pending replacement logic. They are not run and are not counted as passed.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled aria-disabled="true">Workshop transformation checks unavailable</Button>
            <Button type="button" variant="outline" disabled aria-disabled="true">Workshop rewrite and sample checks unavailable</Button>
          </div>
        </section>
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">Live system check</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                This sends real requests and may take substantial time and consume paid API usage.
                Main-page analysis streams provider text as it arrives. Other checks show live request status, then the actual output when their API responds.
                Green means a real result was verified; fallback providers do not pass for the requested key.
              </p>
            </div>
            {isRunning ? (
              <Button type="button" variant="destructive" onClick={stop} className="gap-2" data-testid="button-stop-diagnostics">
                <StopCircle className="h-4 w-4" /> Stop all diagnostics now
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void runAll()} className="gap-2 bg-cyan-700 hover:bg-cyan-800">
                  <Play className="h-4 w-4" /> Run all diagnostics
                </Button>
                <Button type="button" variant="outline" onClick={() => void runAuthorKeyDiagnostics()} className="gap-2" data-testid="button-check-author-keys">
                  <Play className="h-4 w-4" /> Check each author key
                </Button>
                <Button type="button" variant="outline" onClick={() => void runMainFunctionDiagnostics()} className="gap-2" data-testid="button-check-main-functions">
                  <Play className="h-4 w-4" /> Check main-page functions
                </Button>
                <Button type="button" variant="outline" onClick={() => void runReadOnlyDiagnostics()} className="gap-2" data-testid="button-check-read-only">
                  <Play className="h-4 w-4" /> Check read-only functions
                </Button>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <span className="rounded-full bg-slate-100 px-3 py-1">{results.length} checks listed</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{passed} passed</span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">{failed} failed</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{unverified} not verified</span>
          </div>
          {isRunning ? <p role="status" className="mt-3 text-sm font-semibold text-blue-800">Diagnostics running. Results update as each real request completes.</p> : null}
          {wasStopped ? <p role="status" className="mt-3 text-sm font-semibold text-red-800">Stopped. Active requests were canceled, remaining checks will not start, and incomplete checks are not verified.</p> : null}
          {!isRunning && (passed > 0 || failed > 0) ? (
            <p role="status" className={`mt-3 text-sm font-semibold ${failed || unverified ? "text-red-800" : "text-emerald-800"}`}>
              {failed || unverified
                ? "Not all functions and credentials are verified. Review failed and unverified checks before relying on the app."
                : "All listed live checks passed."}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-amber-900">
            Stripe secret and webhook keys cannot be tested safely through the current running server. Clear All, browser reload recovery,
            a complete two-million-character run, payments, and Text Surgeon tools not named above remain unverified.
            No untested function is counted as passed.
          </p>
        </section>
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
          <h2 className="text-lg font-black">Functions that are not yet verified</h2>
          <p className="mt-1">A green result applies only to the named function and actual key tested. The following areas remain unverified; this page does not treat them as passes:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {UNCOVERED_HIGH_IMPACT_CATEGORIES.map((item) => (
              <li key={item.category}><strong>{item.category}:</strong> {item.reason}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          {results.filter((result) => !result.id.startsWith("thinker:")).map((result) => {
            const styles =
              result.status === "passed"
                ? "border-emerald-300 bg-emerald-50"
                : result.status === "failed"
                  ? "border-red-300 bg-red-50"
                    : result.status === "unverified" || result.status === "stopped"
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
                    {traces[result.id] ? (
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setActiveTraceId(result.id)}>
                        View diagnostic popup
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
        <details className="rounded-xl border bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-bold">
            Individual author corpus keys ({results.filter((result) => result.id.startsWith("thinker:") && result.status === "passed").length}/{diagnosticThinkers.length} verified)
          </summary>
          <div className="mt-3 space-y-2">
            {results.filter((result) => result.id.startsWith("thinker:")).map((result) => (
              <div key={result.id} className={`rounded border p-3 text-sm ${result.status === "passed" ? "border-emerald-200 bg-emerald-50" : result.status === "failed" ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                <span className="font-bold">{result.label}: {result.status}</span>
                {result.httpStatus ? ` · HTTP ${result.httpStatus}` : ""}
                {result.durationMs !== undefined ? ` · ${result.durationMs.toLocaleString()} ms` : ""}
                {result.evidence ? <p className="mt-1 break-words">{result.evidence}</p> : null}
                {result.error ? <p className="mt-1 break-words text-red-800">{result.error}</p> : null}
                {traces[result.id] ? (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setActiveTraceId(result.id)}>
                    View diagnostic popup
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
        <DiagnosticLivePopup
          trace={activeTraceId ? traces[activeTraceId] || null : null}
          onClose={() => setActiveTraceId(null)}
          onStop={stop}
          canStop={isRunning}
        />
      </main>
    </div>
  );
}