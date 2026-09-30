import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileInput,
  Loader2,
  RotateCcw,
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

function BoxFooter({ text }: { text: string }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-2">
      <span className="text-xs text-slate-500">Detection is unavailable.</span>
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
  onUnavailable: (message: string) => void;
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
  onUnavailable,
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
    if (!/\.(txt|md)$/i.test(file.name)) {
      onUnavailable("PDF and Word document parsing is unavailable. Upload a plain text or Markdown sample.");
      toast({
        title: "File parsing unavailable",
        description: "Upload a plain text or Markdown sample.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File is too large",
        description: "Workshop sample files are limited to 2 MB.",
        variant: "destructive",
      });
      return;
    }
    setIsLoadingFile(true);
    try {
      const content = await file.text();
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
          accept=".txt,.md"
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
            <p className="text-xs text-slate-500">Detection is unavailable.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HumanizerWorkshop() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [selectedStylePreset, setSelectedStylePreset] = useState("");
  const [styleSample, setStyleSample] = useState("");
  const [styleInstructions, setStyleInstructions] = useState("");
  const [contentSample, setContentSample] = useState("");
  const [contentInstructions, setContentInstructions] = useState("");
  const [aiProseProvider, setAiProseProvider] = useState("perplexity");
  const [isTransforming, setIsTransforming] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [rewriteMessage, setRewriteMessage] = useState("");
  const [isLoadingInputFile, setIsLoadingInputFile] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const inputFile = useRef<HTMLInputElement>(null);

  const unavailable = (action: string) => {
    setRewriteMessage("");
    setRewriteError(`${action} is unavailable while the workshop transformation logic is being replaced.`);
  };

  const transformText = async () => {
    if (isTransforming) return;
    if (!inputText.trim() || !styleSample.trim()) {
      setRewriteError("Enter text in Box A and a style sample in Box D.");
      return;
    }
    if (inputText.trim().split(/\s+/).length > 600) {
      setRewriteError("This initial Workshop version accepts up to 600 words in Box A.");
      return;
    }
    setIsTransforming(true);
    setRewriteError("");
    setRewriteMessage("");
    setSources([]);
    try {
      const response = await fetch("/api/humanizer/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          styleSample,
          instructions: customInstructions,
          styleInstructions,
          contentSample,
          contentInstructions,
          provider: aiProseProvider,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The transformation failed.");
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("The provider returned no prose.");
      setOutputText(result.text);
      setSources(Array.isArray(result.sources) ? result.sources : []);
      setRewriteMessage(`${aiProseProvider === "perplexity" ? "Perplexity" : aiProseProvider} transformation complete.`);
    } catch (error: any) {
      setRewriteError(error?.message || "The transformation failed.");
    } finally {
      setIsTransforming(false);
    }
  };

  const loadInputFile = async (file: File) => {
    if (!/\.(txt|md)$/i.test(file.name)) {
      unavailable("PDF and Word document parsing");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setRewriteError("Source files are limited to 50 MB.");
      return;
    }
    setIsLoadingInputFile(true);
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("The document contained no readable text.");
      setInputText(text);
      setOutputText("");
      setRewriteError("");
      setRewriteMessage("");
    } catch (error: any) {
      setRewriteError(error?.message || "Could not load this document.");
    } finally {
      setIsLoadingInputFile(false);
      if (inputFile.current) inputFile.current.value = "";
    }
  };

  const downloadOutput = () => {
    if (!outputText.trim()) return;
    const downloadableText = sources.length
      ? `${outputText}\n\nResearch sources:\n${sources.map((source, index) => `[${index + 1}] ${source}`).join("\n")}`
      : outputText;
    const url = URL.createObjectURL(new Blob([downloadableText], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "humanizer-box-b-result.txt";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => window.location.reload()}
              data-testid="button-clear-all-workshop"
            >
              <RotateCcw className="h-4 w-4" /> Clear All
            </Button>
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
                  <p className="text-xs text-blue-700">Enter up to 600 words here; Box D controls the prose style.</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-5 py-3">
              <input
                ref={inputFile}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadInputFile(file);
                }}
              />
              <Button
                type="button"
                 onClick={() => void transformText()}
                 disabled={isTransforming}
                className="gap-2 bg-blue-700 text-white hover:bg-blue-800"
                data-testid="button-rewrite-workshop"
              >
                 {isTransforming ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />} {isTransforming ? "Transforming…" : "Transform Text"}
              </Button>
              {import.meta.env.DEV ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => unavailable("The supplied On Certainty rewrite")}
                  className="gap-2 bg-white"
                  data-testid="button-start-supplied-rewrite"
                >
                  <WandSparkles className="h-4 w-4" /> Start On Certainty — 45,000 words
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => inputFile.current?.click()}
                disabled={isLoadingInputFile}
                className="gap-2 bg-white"
                data-testid="button-upload-source"
              >
                {isLoadingInputFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isLoadingInputFile ? "Reading…" : "Upload document"}
              </Button>
              <Select value={aiProseProvider} onValueChange={setAiProseProvider}>
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
               <span className="text-xs text-blue-700">Perplexity is the default for web-supported additions. Other providers may not research the web.</span>
            </div>
            <Textarea
              value={inputText}
              onChange={(event) => {
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
                   <p className="text-xs text-emerald-700">The transformed text appears here and remains editable.</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-3">
              <Button
                type="button"
                 onClick={() => void transformText()}
                 disabled={isTransforming}
                className="gap-2 bg-emerald-700 text-white hover:bg-emerald-800"
                data-testid="button-rewrite-output"
              >
                <WandSparkles className="h-4 w-4" /> Rewrite
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => unavailable("Loading saved results")}
                className="gap-2 bg-white"
                data-testid="button-load-output"
              >
                <Upload className="h-4 w-4" /> Load saved result
              </Button>
              <Button type="button" variant="outline" onClick={downloadOutput} disabled={!outputText.trim()} className="gap-2 bg-white" data-testid="button-download-output">
                <Download className="h-4 w-4" /> Download Box B
              </Button>
               <span className="text-xs text-emerald-800">Saved-result loading is unavailable.</span>
            </div>
            {rewriteMessage ? (
              <p role="status" className="border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-xs font-semibold text-emerald-900">{rewriteMessage}</p>
            ) : null}
            {rewriteError ? (
              <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800">{rewriteError}</p>
            ) : null}
            {sources.length > 0 ? (
              <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-xs text-emerald-900">
                Research sources: {sources.map((url, index) => (
                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="mr-3 underline">[{index + 1}]</a>
                ))}
              </div>
            ) : null}
            <Textarea
              value={outputText}
              onChange={(event) => {
                setOutputText(event.target.value);
                setSources([]);
                setRewriteMessage("");
                setRewriteError("");
              }}
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
               <p className="text-xs text-violet-700">Optional. Clarity, support, vivid examples, and style matching apply by default.</p>
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
           description="The controlling model for syntax, diction, examples, illustrations, and argument."
          color="amber"
          value={styleSample}
          onChange={setStyleSample}
          instructions={styleInstructions}
          onInstructionsChange={setStyleInstructions}
          onUnavailable={setRewriteError}
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
          onUnavailable={setRewriteError}
        />
      </main>
    </div>
  );
}