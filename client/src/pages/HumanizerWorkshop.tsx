import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  FileInput,
  Loader2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  SlidersHorizontal,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { humanizerStylePresets } from "@/data/humanizerStylePresets";

const WORKSHOP_FILE_LIMIT = 2 * 1024 * 1024;
const AUTHORS = [
  "Adam Smith", "Adler", "Aesop", "Allen", "Aristotle", "Bacon", "Bergler",
  "Bergson", "Berkeley", "Confucius", "Darwin", "Descartes", "Dewey",
  "Dworkin", "Emma Goldman", "Engels", "Freud", "Galileo", "Gardner",
  "Hegel", "Hobbes", "Hume", "Jung", "Kant", "Kernberg", "Kuczynski",
  "La Rochefoucauld", "Laplace", "Le Bon", "Leibniz", "Locke", "Luther",
  "Machiavelli", "Maimonides", "Marden", "Marx", "Mill", "Newton",
  "Nietzsche", "Peirce", "Plato", "Poincaré", "Popper", "Rousseau",
  "Russell", "Sartre", "Schopenhauer", "Spencer", "Stekel", "Tocqueville",
  "Veblen", "Weyl", "Whewell", "William James",
] as const;

type WorkshopProvider =
  | "gemini"
  | "openai"
  | "anthropic"
  | "grok"
  | "perplexity"
  | "deepseek"
  | "venice";

type GptZeroState =
  | { status: "waiting" }
  | { status: "scanning" }
  | { status: "complete"; text: string; classification: string; confidence?: string; aiScore?: number }
  | { status: "error"; text: string; message: string };

function getAiScore(probabilities: unknown): number | undefined {
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return undefined;
  const scores = probabilities as Record<string, unknown>;
  const aiKey = Object.keys(scores).find((key) =>
    /^(ai|ai_generated|ai_probability|completely_generated|completely_generated_prob)$/i.test(key),
  );
  const probability = aiKey ? scores[aiKey] : undefined;
  return typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1
    ? Math.round(probability * 100)
    : undefined;
}

function getWorkshopVisitorId() {
  const key = "humanizer-workshop-visitor-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = `workshop-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

async function detectWorkshopText(text: string, signal?: AbortSignal): Promise<Extract<GptZeroState, { status: "complete" }>> {
  const normalized = text.trim();
  const response = await fetch("/api/gptzero/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify({ text: normalized, visitorId: getWorkshopVisitorId() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "GPTZero scan failed");
  const classification = payload?.documentClassification || payload?.predictedClass;
  if (typeof classification !== "string" || !classification) throw new Error("GPTZero returned no classification");
  return {
    status: "complete",
    text: normalized,
    classification,
    confidence: typeof payload?.confidenceCategory === "string" ? payload.confidenceCategory : undefined,
    aiScore: getAiScore(payload?.classProbabilities),
  };
}

function useAutomaticGptZero(text: string): GptZeroState {
  const [state, setState] = useState<GptZeroState>({ status: "waiting" });
  const requestId = useRef(0);

  useEffect(() => {
    const normalized = text.trim();
    if (normalized.length < 50) {
      requestId.current += 1;
      setState({ status: "waiting" });
      return;
    }

    const activeRequest = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      setState({ status: "scanning" });
      try {
        const result = await detectWorkshopText(normalized);
        if (activeRequest !== requestId.current) return;
        setState(result);
      } catch (error: any) {
        if (activeRequest !== requestId.current) return;
        setState({
          status: "error",
          text: normalized,
          message: error?.message || "GPTZero scan failed",
        });
      }
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [text]);

  if (text.trim().length < 50) return { status: "waiting" };
  if (state.status === "waiting" || ((state.status === "complete" || state.status === "error") && state.text !== text.trim())) {
    return { status: "scanning" };
  }
  return state;
}

function GptZeroReadout({ state, previousAiScore }: { state: GptZeroState; previousAiScore?: number }) {
  if (state.status === "waiting") {
    return <span className="text-xs text-slate-500">GPTZero: waiting for 50 characters</span>;
  }
  if (state.status === "scanning") {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> GPTZero: scanning automatically
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700" title={state.message}>
        <AlertCircle className="h-3 w-3" /> GPTZero: {state.message}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
      <ShieldCheck className="h-3 w-3" />
      GPTZero: {state.aiScore !== undefined ? `${state.aiScore}% AI likelihood · ` : ""}
      {state.classification.replaceAll("_", " ")}
      {state.confidence ? ` · ${state.confidence}` : ""}
      {previousAiScore !== undefined && state.aiScore !== undefined ? ` · previous ${previousAiScore}%` : ""}
    </span>
  );
}

function AutomaticGptZeroReadout({ text }: { text: string }) {
  return <GptZeroReadout state={useAutomaticGptZero(text)} />;
}

function BoxFooter({ text, detection, previousAiScore }: { text: string; detection?: GptZeroState; previousAiScore?: number }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-2">
      {detection ? <GptZeroReadout state={detection} previousAiScore={previousAiScore} /> : <AutomaticGptZeroReadout text={text} />}
      <span className="text-xs font-semibold text-slate-600">{words.toLocaleString()} words</span>
    </div>
  );
}

type SampleBoxProps = {
  boxLabel: string;
  title: string;
  description: string;
  color: "amber" | "rose";
  value: string;
  onChange: (value: string) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
};

function SampleBox({
  boxLabel,
  title,
  description,
  color,
  value,
  onChange,
  instructions,
  onInstructionsChange,
}: SampleBoxProps) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [author, setAuthor] = useState("");
  const [sampleLength, setSampleLength] = useState("500");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const isAmber = color === "amber";
  const border = isAmber ? "border-amber-300" : "border-rose-300";
  const header = isAmber ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50";
  const textColor = isAmber ? "text-amber-950" : "text-rose-950";
  const accent = isAmber ? "text-amber-700" : "text-rose-700";

  const loadFile = async (file: File) => {
    const extension = file.name.toLowerCase().split(".").pop() || "";
    if (!["txt", "md", "pdf", "docx"].includes(extension)) {
      toast({
        title: "Unsupported file",
        description: "Upload a PDF, DOCX, text, or Markdown file.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > WORKSHOP_FILE_LIMIT) {
      toast({
        title: "File is too large",
        description: "Workshop sample files are limited to 2 MB.",
        variant: "destructive",
      });
      return;
    }
    setIsLoadingFile(true);
    try {
      let content = "";
      if (extension === "pdf" || extension === "docx") {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/parse-style-sample", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Could not parse the file");
        content = payload?.text || "";
      } else {
        content = await file.text();
      }
      if (!content.trim()) throw new Error("The file did not contain readable text");
      onChange(content);
      toast({ title: "Sample loaded", description: file.name });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message || "Could not load the sample",
        variant: "destructive",
      });
    } finally {
      setIsLoadingFile(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className={`overflow-hidden rounded-xl border-2 bg-white shadow-lg ${border}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 ${header}`}>
        <div className="flex items-center gap-2">
          <BookOpen className={`h-5 w-5 ${accent}`} />
          <div>
            <h2 className={`font-black uppercase tracking-wide ${textColor}`}>
              {boxLabel} — {title}
            </h2>
            <p className={`text-xs ${accent}`}>{description}</p>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.pdf,.docx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={isLoadingFile}
        >
          {isLoadingFile ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
          Upload
        </Button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div
          className={`flex min-h-[300px] flex-col overflow-hidden rounded-lg border-2 border-dashed ${
            isDragging ? `${border} ${header}` : "border-slate-300"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void loadFile(file);
          }}
        >
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Type, paste, or drag and drop a sample here…"
            className="min-h-[250px] flex-1 resize-y border-0 p-4 font-serif text-base leading-relaxed focus-visible:ring-0"
          />
          <BoxFooter text={value} />
        </div>

        <div className="space-y-4 rounded-lg border bg-slate-50 p-4">
          <div className="space-y-1.5">
            <Label>Choose an author from this site</Label>
            <Select value={author} onValueChange={setAuthor}>
              <SelectTrigger>
                <SelectValue placeholder="Select an author…" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {AUTHORS.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Requested author-sample length</Label>
            <Select value={sampleLength} onValueChange={setSampleLength}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="250">Approximately 250 words</SelectItem>
                <SelectItem value="500">Approximately 500 words</SelectItem>
                <SelectItem value="1000">Approximately 1,000 words</SelectItem>
                <SelectItem value="2000">Approximately 2,000 words</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {author
              ? `${author} is selected for a ${Number(sampleLength).toLocaleString()}-word sample. Direct corpus retrieval will activate when the Genius 101 service address is connected.`
              : "Select an author or provide your own sample in the text area."}
          </div>
          <div className="space-y-1.5">
            <Label>Instructions for using this box</Label>
            <Textarea
              value={instructions}
              onChange={(event) => onInstructionsChange(event.target.value)}
              placeholder={
                title === "Style Sample"
                  ? "Explain which stylistic qualities should be copied or avoided…"
                  : "Explain what substance should be extracted, emphasized, or excluded…"
              }
              className="min-h-[130px] resize-y bg-white"
            />
            <AutomaticGptZeroReadout text={instructions} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HumanizerWorkshop() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const outputDetection = useAutomaticGptZero(outputText);
  const [previousAiScore, setPreviousAiScore] = useState<number | undefined>();
  const [customInstructions, setCustomInstructions] = useState("Rewrite in style of sample");
  const [selectedStylePreset, setSelectedStylePreset] = useState("");
  const [styleSample, setStyleSample] = useState("");
  const [styleInstructions, setStyleInstructions] = useState("");
  const [contentSample, setContentSample] = useState("");
  const [contentInstructions, setContentInstructions] = useState("");
  const [aiProseProvider, setAiProseProvider] = useState<WorkshopProvider>("gemini");
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState("");
  const [rewriteError, setRewriteError] = useState("");
  const rewriteRequest = useRef<AbortController | null>(null);

  const rewriteText = async (source: string, fromOutput = false) => {
    if (!source.trim()) return;
    if (fromOutput && source.trim().length < 50) {
      setRewriteError("Box B needs at least 50 characters for an AI score before a score-guided rewrite.");
      return;
    }
    rewriteRequest.current?.abort();
    const controller = new AbortController();
    rewriteRequest.current = controller;
    setIsRewriting(true);
    setRewriteError("");
    setRewriteMessage("");
    try {
      const feedback = fromOutput
        ? outputDetection.status === "complete" && outputDetection.text === source.trim()
          ? outputDetection
          : await detectWorkshopText(source, controller.signal)
        : null;
      if (controller.signal.aborted) return;
      const instructions = feedback
        ? `${customInstructions.trim()}\n\nRevise the current Box B draft using this GPTZero result for this exact text: ${feedback.aiScore !== undefined ? `${feedback.aiScore}% AI likelihood` : `classification ${feedback.classification}`}${feedback.confidence ? ` (${feedback.confidence} confidence)` : ""}. Aim for a lower AI likelihood by improving natural variation and clarity, while preserving the draft's subject, facts, voice, and approximate length. Do not add unrelated content or claim any score is guaranteed.`
        : customInstructions;
      if (instructions.length > 3_000) throw new Error("Box C instructions are too long for a score-guided rewrite.");
      const response = await fetch("/api/humanizer/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          text: source,
          provider: aiProseProvider,
          instructions,
          styleSample,
          styleInstructions,
          contentSample,
          contentInstructions,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Rewrite failed.");
      if (typeof payload?.text !== "string" || !payload.text.trim()) {
        throw new Error("The provider returned no rewritten prose.");
      }
      if (rewriteRequest.current !== controller) return;
      setOutputText(payload.text);
      setPreviousAiScore(feedback?.aiScore);
      setRewriteMessage(
        `${payload.fallbackReason || `Rewritten with ${String(payload.provider || aiProseProvider)}.`}${feedback ? ` Previous GPTZero result: ${feedback.aiScore !== undefined ? `${feedback.aiScore}% AI likelihood` : feedback.classification}. The new draft is being rescanned.` : ""}`,
      );
    } catch (error: any) {
      if (rewriteRequest.current === controller && error?.name !== "AbortError") {
        setRewriteError(error?.message || "Rewrite failed.");
      }
    } finally {
      if (rewriteRequest.current === controller) {
        rewriteRequest.current = null;
        setIsRewriting(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b-4 border-cyan-600 bg-white shadow-md">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white shadow-md">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-wide sm:text-2xl">Humanizer Workshop</h1>
              <p className="text-sm text-slate-600">
                A laboratory for testing different approaches to making AI prose read more naturally.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/humanizer-workshop/diagnostics">
              <Button variant="outline" className="gap-2">
                <Stethoscope className="h-4 w-4" /> Diagnostics
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Text Surgeon
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-5 p-5 lg:p-8">
        <section className="grid min-h-[58vh] grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 border-blue-300 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <FileInput className="h-5 w-5 text-blue-700" />
                <div>
                  <h2 className="font-black uppercase tracking-wide text-blue-950">Box A — Text Input</h2>
                  <p className="text-xs text-blue-700">Paste your text here; put the target style sample in Box D.</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-5 py-3">
                <Button
                  type="button"
                  onClick={() => void rewriteText(inputText)}
                  disabled={!inputText.trim() || isRewriting}
                  className="gap-2 bg-blue-700 text-white hover:bg-blue-800"
                  data-testid="button-rewrite-workshop"
                >
                  {isRewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                  {isRewriting ? "Transforming…" : "Transform Text"}
                </Button>
                <Select
                  value={aiProseProvider}
                  onValueChange={(value) => setAiProseProvider(value as WorkshopProvider)}
                >
                  <SelectTrigger aria-label="Transformation model" className="w-[125px] bg-white" data-testid="select-ai-prose-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="grok">Grok</SelectItem>
                    <SelectItem value="perplexity">Perplexity</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="venice">Venice AI</SelectItem>
                  </SelectContent>
                </Select>
            </div>
            <Textarea
              value={inputText}
              onChange={(event) => {
                rewriteRequest.current?.abort();
                setInputText(event.target.value);
                setOutputText("");
                setRewriteMessage("");
                setRewriteError("");
              }}
              placeholder="Type or paste the original text here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
            />
            <BoxFooter text={inputText} />
          </div>

          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 border-emerald-300 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-700" />
                <div>
                  <h2 className="font-black uppercase tracking-wide text-emerald-950">Box B — Text Output</h2>
                  <p className="text-xs text-emerald-700">Transformed text appears here after pressing Transform Text.</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-3">
              <Button
                type="button"
                onClick={() => void rewriteText(outputText, true)}
                disabled={!outputText.trim() || isRewriting}
                className="gap-2 bg-emerald-700 text-white hover:bg-emerald-800"
                data-testid="button-rewrite-output"
              >
                {isRewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                {isRewriting ? "Rewriting…" : "Rewrite"}
              </Button>
              <span className="text-xs text-emerald-800">Rewrite the current Box B text using its GPTZero result.</span>
            </div>
            {rewriteMessage ? (
              <p role="status" className="border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-xs font-semibold text-emerald-900">{rewriteMessage}</p>
            ) : null}
            {rewriteError ? (
              <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800">Rewrite failed: {rewriteError}</p>
            ) : null}
            <Textarea
              value={outputText}
              onChange={(event) => {
                rewriteRequest.current?.abort();
                setOutputText(event.target.value);
                setPreviousAiScore(undefined);
                setRewriteMessage("");
                setRewriteError("");
              }}
              placeholder="Humanized output will appear here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-emerald-50/20 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
            />
            <BoxFooter text={outputText} detection={outputDetection} previousAiScore={previousAiScore} />
          </div>
        </section>

        <section className="flex min-h-[220px] flex-col overflow-hidden rounded-xl border-2 border-violet-300 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-5 py-3">
            <SlidersHorizontal className="h-5 w-5 text-violet-700" />
            <div>
              <h2 className="font-black uppercase tracking-wide text-violet-950">Box C — Custom Instructions</h2>
              <p className="text-xs text-violet-700">Specify exactly how the text should be humanized.</p>
            </div>
          </div>
          <div className="border-b border-violet-200 bg-violet-50/50 px-5 py-3">
            <Label htmlFor="humanizer-style-preset">Style preset</Label>
            <Select
              value={selectedStylePreset}
              onValueChange={(id) => {
                const preset = humanizerStylePresets.find((item) => item.id === id);
                if (!preset) return;
                setSelectedStylePreset(id);
                setCustomInstructions(preset.instruction);
              }}
            >
              <SelectTrigger id="humanizer-style-preset" className="mt-1 w-full bg-white sm:max-w-xl" data-testid="select-style-preset">
                <SelectValue placeholder="Choose one of your supplied style presets…" />
              </SelectTrigger>
              <SelectContent className="max-h-80 w-[min(90vw,40rem)]">
                {humanizerStylePresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id} className="[&>span:last-child]:whitespace-normal">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-violet-700">Choosing a preset fills Box C. You can edit it before transforming.</p>
          </div>
          <Textarea
            value={customInstructions}
            onChange={(event) => {
              setCustomInstructions(event.target.value);
              setSelectedStylePreset("");
            }}
            placeholder="Enter your custom humanization instructions here…"
            className="min-h-[150px] flex-1 resize-y rounded-none border-0 p-5 text-base leading-relaxed focus-visible:ring-0"
          />
          <BoxFooter text={customInstructions} />
        </section>

        <SampleBox
          boxLabel="Box D"
          title="Style Sample"
          description="Provide a sample whose prose style should guide the transformation."
          color="amber"
          value={styleSample}
          onChange={setStyleSample}
          instructions={styleInstructions}
          onInstructionsChange={setStyleInstructions}
        />

        <SampleBox
          boxLabel="Box E"
          title="Content Sample"
          description="Provide source material whose substance may inform the transformation."
          color="rose"
          value={contentSample}
          onChange={setContentSample}
          instructions={contentInstructions}
          onInstructionsChange={setContentInstructions}
        />
      </main>
    </div>
  );
}