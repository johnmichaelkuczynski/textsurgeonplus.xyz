import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileInput, Sparkles, SlidersHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function HumanizerWorkshop() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  const inputWords = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
  const outputWords = outputText.trim() ? outputText.trim().split(/\s+/).length : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b-4 border-cyan-600 bg-white shadow-md">
        <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white shadow-md">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-wide sm:text-2xl">
                Humanizer Workshop
              </h1>
              <p className="text-sm text-slate-600">
                A dedicated workspace for transforming text.
              </p>
            </div>
          </div>
          <Link href="/">
            <Button variant="outline" className="gap-2" data-testid="button-back-to-text-surgeon">
              <ArrowLeft className="h-4 w-4" />
              Text Surgeon
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-76px)] flex-col gap-5 p-5 lg:p-8">
        <section className="grid min-h-[58vh] flex-1 grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 border-blue-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <FileInput className="h-5 w-5 text-blue-700" />
                <div>
                  <h2 className="font-black uppercase tracking-wide text-blue-950">
                    Box A — Text Input
                  </h2>
                  <p className="text-xs text-blue-700">
                    Enter or paste the text to be humanized.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-blue-700">
                {inputWords.toLocaleString()} words
              </span>
            </div>
            <Textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Type or paste the original text here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
              data-testid="textarea-humanizer-input"
            />
          </div>

          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border-2 border-emerald-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-700" />
                <div>
                  <h2 className="font-black uppercase tracking-wide text-emerald-950">
                    Box B — Text Output
                  </h2>
                  <p className="text-xs text-emerald-700">
                    The humanized text will appear here.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-emerald-700">
                {outputWords.toLocaleString()} words
              </span>
            </div>
            <Textarea
              value={outputText}
              onChange={(event) => setOutputText(event.target.value)}
              placeholder="Humanized output will appear here…"
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-emerald-50/20 p-5 font-serif text-base leading-relaxed focus-visible:ring-0"
              data-testid="textarea-humanizer-output"
            />
          </div>
        </section>

        <section className="flex min-h-[210px] flex-col overflow-hidden rounded-xl border-2 border-violet-300 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-5 py-3">
            <SlidersHorizontal className="h-5 w-5 text-violet-700" />
            <div>
              <h2 className="font-black uppercase tracking-wide text-violet-950">
                Box C — Custom Instructions
              </h2>
              <p className="text-xs text-violet-700">
                Specify exactly how the text should be humanized.
              </p>
            </div>
          </div>
          <Textarea
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
            placeholder="Enter your custom humanization instructions here…"
            className="min-h-[150px] flex-1 resize-y rounded-none border-0 p-5 text-base leading-relaxed focus-visible:ring-0"
            data-testid="textarea-humanizer-instructions"
          />
        </section>
      </main>
    </div>
  );
}