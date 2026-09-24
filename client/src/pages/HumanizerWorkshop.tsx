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
  | "deepseek";

type GptZeroState =
  | { status: "waiting" }
  | { status: "scanning" }
  | { status: "complete"; classification: string; confidence?: string }
  | { status: "error"; message: string };

function getWorkshopVisitorId() {
  const key = "humanizer-workshop-visitor-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = `workshop-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
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
        const response = await fetch("/api/gptzero/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: normalized,
            visitorId: getWorkshopVisitorId(),
          }),
        });
        const payload = await response.json().catch(() => null);
        if (activeRequest !== requestId.current) return;
        if (!response.ok) {
          throw new Error(payload?.error || "GPTZero scan failed");
        }
        setState({
          status: "complete",
          classification:
            payload?.documentClassification || payload?.predictedClass || "Unknown",
          confidence: payload?.confidenceCategory || undefined,
        });
      } catch (error: any) {
        if (activeRequest !== requestId.current) return;
        setState({
          status: "error",
          message: error?.message || "GPTZero scan failed",
        });
      }
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [text]);

  return state;
}

function GptZeroReadout({ text }: { text: string }) {
  const state = useAutomaticGptZero(text);
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
      GPTZero: {state.classification.replaceAll("_", " ")}
      {state.confidence ? ` · ${state.confidence}` : ""}
    </span>
  );
}

function BoxFooter({ text }: { text: string }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-2">
      <GptZeroReadout text={text} />
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
            <GptZeroReadout text={instructions} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HumanizerWorkshop() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [customInstructions, setCustomInstructions] = useState("Rewrite in style of sample");
  const [styleSample, setStyleSample] = useState("");
  const [styleInstructions, setStyleInstructions] = useState("");
  const [contentSample, setContentSample] = useState("");
  const [contentInstructions, setContentInstructions] = useState("");
  const [aiProseProvider, setAiProseProvider] = useState<WorkshopProvider>("gemini");
  const [aiProseLengthMode, setAiProseLengthMode] = useState<"sentence" | "words">("words");
  const [aiProseWordCount, setAiProseWordCount] = useState(500);
  const [isGeneratingAiProse, setIsGeneratingAiProse] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationError, setGenerationError] = useState("");

  const generateObviousAiProse = async () => {
    if (isGeneratingAiProse) return;
    setIsGeneratingAiProse(true);
    setGenerationError("");
    setGenerationMessage("");
    try {
      const response = await fetch("/api/humanizer/generate-ai-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: aiProseProvider,
          lengthMode: aiProseLengthMode,
          wordCount: Math.max(1, Math.min(2_000, aiProseWordCount)),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "AI prose generation failed");
      }
      if (typeof payload?.text !== "string" || !payload.text.trim()) {
        throw new Error("The provider returned no generated prose.");
      }
      setInputText(payload.text);
      setGenerationMessage(
        payload.fallbackReason ||
          `Generated with ${String(payload.provider || aiProseProvider)}.`,
      );
    } catch (error: any) {
      setGenerationError(error?.message || "Generation failed. Please try again.");
    } finally {
      setIsGeneratingAiProse(false);
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
              <FileInput className="h-5 w-5 text-blue-700" />
              <div>
                <h2 className="font-black uppercase tracking-wide text-blue-950">Box A — Text Input</h2>
                <p className="text-xs text-blue-700">Enter or paste the text to be humanized.</p>
              </div>
            </div>
            <div className="space-y-3 border-b border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 p-4">
              <div className="flex items-center gap-2">
                <WandSparkles className="h-4 w-4 text-blue-700" />
                <span className="text-sm font-black uppercase tracking-wide text-blue-950">
                  Generate deliberately obvious AI prose
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(120px,1fr)_minmax(150px,1.2fr)_90px_110px]">
                <Select
                  value={aiProseProvider}
                  onValueChange={(value) => setAiProseProvider(value as WorkshopProvider)}
                >
                  <SelectTrigger aria-label="AI provider" data-testid="select-ai-prose-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="grok">Grok</SelectItem>
                    <SelectItem value="perplexity">Perplexity</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={aiProseLengthMode}
                  onValueChange={(value) => setAiProseLengthMode(value as "sentence" | "words")}
                >
                  <SelectTrigger data-testid="select-ai-prose-length-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sentence">One sentence</SelectItem>
                    <SelectItem value="words">Custom word count</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  type="number"
                  min={1}
                  max={2_000}
                  value={aiProseWordCount}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    setAiProseWordCount(Number.isFinite(value) ? value : 1);
                  }}
                  disabled={aiProseLengthMode === "sentence"}
                  aria-label="Requested word count"
                  className="h-10 rounded-md border border-blue-300 bg-white px-3 text-sm outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  data-testid="input-ai-prose-word-count"
                />
                <Button
                  type="button"
                  onClick={() => void generateObviousAiProse()}
                  disabled={isGeneratingAiProse}
                  className="h-10 min-w-[110px] bg-blue-700 px-3 text-white hover:bg-blue-800"
                  data-testid="button-generate-obvious-ai-prose"
                >
                  {isGeneratingAiProse ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Generate
                </Button>
              </div>
              <p className="text-xs text-blue-800">
                Creates intentionally formulaic AI-written material on a randomly selected subject.
                Gemini is selected by default. Custom lengths may range from 1 to 2,000 words.
                GPTZero evaluates generated text automatically.
              </p>
              {generationMessage ? (
                <p role="status" className="text-xs font-semibold text-blue-900">{generationMessage}</p>
              ) : null}
              {generationError ? (
                <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                  Generation failed: {generationError}
                </p>
              ) : null}
            </div>
            <Textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Type or paste the original text here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
            />
            <BoxFooter text={inputText} />
          </div>

          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 border-emerald-300 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-3">
              <Sparkles className="h-5 w-5 text-emerald-700" />
              <div>
                <h2 className="font-black uppercase tracking-wide text-emerald-950">Box B — Text Output</h2>
                <p className="text-xs text-emerald-700">The humanized text will appear here.</p>
              </div>
            </div>
            <Textarea
              value={outputText}
              onChange={(event) => setOutputText(event.target.value)}
              placeholder="Humanized output will appear here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-emerald-50/20 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
            />
            <BoxFooter text={outputText} />
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
          <Textarea
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
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