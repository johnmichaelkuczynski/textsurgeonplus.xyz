import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

type Mode = "A" | "B" | "C" | "D";
type Chapter = { index: number; number: number; title: string; wordCount: number };
type Statement = { number: string; text: string; depth: number };
type Tree = { index: number; title: string; statements: Statement[]; complete: boolean };

export function FreshTreeDialog({
  open, onOpenChange, text, selection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  selection: string;
}) {
  const [mode, setMode] = useState<Mode>("A");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [fourthAttempted, setFourthAttempted] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setMode(selection.trim() ? "D" : "A");
      setChosen([]);
      setTrees([]);
      setErrors([]);
      setProgress("");
      setFinished(false);
      setFourthAttempted(false);
    } else {
      request.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    if (!open || (mode !== "B" && mode !== "C")) return;
    const controller = new AbortController();
    setLoadingChapters(true);
    setChapters([]);
    fetch("/api/fresh-tree/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chapter detection failed.");
      setChapters(data.chapters);
      if (!data.chapters.length) setErrors(["No body chapters were detected. Check the chapter headings."]);
      else setErrors([]);
    }).catch((error) => {
      if (!controller.signal.aborted) setErrors([error.message || "Chapter detection failed."]);
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingChapters(false);
    });
    return () => controller.abort();
  }, [open, mode, text]);

  const close = () => {
    request.current?.abort();
    request.current = null;
    setRunning(false);
    onOpenChange(false);
  };

  const run = async (phase: "generate" | "fourth") => {
    if (request.current) return;
    if (mode === "D" && !selection.trim()) {
      setErrors(["Highlight text in the main text box first"]);
      return;
    }
    if (mode === "C" && !chosen.length) {
      setErrors(["Tick at least one detected chapter."]);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setErrors([]);
    setProgress("");
    if (phase === "generate") {
      setTrees([]);
      setFinished(false);
      setFourthAttempted(false);
    } else {
      setFourthAttempted(true);
    }
    try {
      const response = await fetch("/api/fresh-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          text, selection, mode,
          indices: chosen,
          phase,
          trees: phase === "fourth" ? trees.filter((tree) => tree.complete).map((tree) => ({
            index: tree.index, statements: tree.statements.filter((s) => s.depth <= 2),
          })) : undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Fresh Tree request failed (${response.status}).`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Fresh Tree returned no response body.");
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted || done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          if (controller.signal.aborted) break;
          const line = event.split("\n").find((line) => line.startsWith("data: "));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "progress") setProgress(data.message);
          else if (data.type === "chapter-error") {
            setErrors((previous) => [...previous, `${data.title}: ${data.error}`]);
          } else if (data.type === "error") throw new Error(data.error);
          else if (data.type === "complete") completed = true;
          else if (data.type === "thesis" || data.type === "fourth" || data.type === "chapter-complete") {
            setTrees((previous) => {
              const entry = previous.find((tree) => tree.index === data.index);
              if (!entry && data.type === "chapter-complete") return previous;
              const updated: Tree = entry
                ? { ...entry }
                : { index: data.index, title: data.title, statements: [], complete: false };
              if (data.type === "chapter-complete") updated.complete = true;
              else if (data.type === "thesis") updated.statements = [...updated.statements, ...data.statements];
              else {
                const additions = new Map<string, Statement>(data.statements.map((item: Statement) =>
                  [item.number.slice(0, item.number.lastIndexOf(".")), item]));
                updated.statements = updated.statements.flatMap((item) => {
                  const child = item.depth === 2 ? additions.get(item.number) : undefined;
                  return child ? [item, child] : [item];
                });
              }
              return [...previous.filter((tree) => tree.index !== data.index), { ...updated }]
                .sort((a, b) => a.index - b.index);
            });
          }
        }
      }
      if (!completed && !controller.signal.aborted) throw new Error("Fresh Tree stopped before completion.");
      if (!controller.signal.aborted && phase === "generate") setFinished(true);
      if (!controller.signal.aborted) setProgress("");
    } catch (error: any) {
      if (!controller.signal.aborted) setErrors((previous) => [...previous, error.message || "Fresh Tree failed."]);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRunning(false);
      }
    }
  };

  const output = trees.map((tree) => {
    const chapter = chapters.find((item) => item.index === tree.index);
    const heading = mode === "B" || mode === "C"
      ? `CHAPTER ${chapter?.number ?? tree.index + 1}: ${tree.title.replace(/^chapter\s+(?:\d+|[ivxlcdm]+|[a-z]+)\s*[:.—–-]?\s*/i, "") || "Untitled"}\n`
      : "";
    return heading + tree.statements.map((statement) => `${statement.number} ${statement.text}`).join("\n");
  }).join("\n\n");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto [&>button]:hidden" data-testid="fresh-tree-dialog">
        <DialogHeader><DialogTitle>FRESH TREE</DialogTitle></DialogHeader>
        <RadioGroup value={mode} onValueChange={(value) => {
          if (running) return;
          setMode(value as Mode);
          setTrees([]);
          setErrors([]);
          setFinished(false);
          setFourthAttempted(false);
        }} aria-label="Fresh Tree input">
          {([
            ["A", "Whole book — one tree"],
            ["B", "Whole book — each chapter gets its own tree"],
            ["C", "Selected chapters — each gets its own tree"],
            ["D", "Manual select"],
          ] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value={value} disabled={running} data-testid={`fresh-tree-mode-${value}`} />
              {label}
            </label>
          ))}
        </RadioGroup>
        {(mode === "B" || mode === "C") && (
          <div className="max-h-44 overflow-y-auto rounded border border-yellow-200 p-3" data-testid="fresh-tree-chapters">
            {loadingChapters ? "Detecting chapters…" : chapters.map((chapter) => (
              <label key={chapter.index} className="flex items-center gap-2 py-1 text-sm">
                {mode === "C" && (
                  <Checkbox checked={chosen.includes(chapter.index)} disabled={running}
                    onCheckedChange={(checked) => setChosen((old) =>
                      checked ? [...old, chapter.index] : old.filter((index) => index !== chapter.index))}
                    data-testid={`fresh-tree-chapter-${chapter.index}`} />
                )}
                {chapter.number}. {chapter.title} ({chapter.wordCount} words)
              </label>
            ))}
          </div>
        )}
        {mode === "D" && !selection.trim() && (
          <p className="text-red-700 text-sm" role="alert">Highlight text in the main text box first</p>
        )}
        {progress && <p className="text-sm" role="status">{progress}</p>}
        {errors.map((error, index) => <p key={`${index}-${error}`} className="text-red-700 text-sm" role="alert">{error}</p>)}
        {trees.length > 0 && (
          <div className="rounded border border-yellow-300 bg-yellow-50 p-3" data-testid="fresh-tree-results">
            <pre className="whitespace-pre-wrap break-words text-sm">{output}</pre>
            <div className="flex gap-2 mt-3">
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(output).catch(() =>
                setErrors((previous) => [...previous, "Copy failed."]))}>Copy</Button>
              <Button variant="outline" onClick={() => {
                const url = URL.createObjectURL(new Blob([output], { type: "text/plain" }));
                const link = document.createElement("a");
                link.href = url;
                link.download = "fresh-tree.txt";
                link.click();
                URL.revokeObjectURL(url);
              }}>Download .txt</Button>
            </div>
            {finished && trees.some((tree) => tree.complete) && !fourthAttempted && (
              <Button className="mt-3" disabled={running} onClick={() => void run("fourth")} data-testid="fresh-tree-fourth">
                ADD FOURTH TIER
              </Button>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} data-testid="fresh-tree-cancel">CANCEL</Button>
          <Button onClick={() => void run("generate")} disabled={running ||
            ((mode === "B" || mode === "C") && (loadingChapters || !chapters.length))}
            data-testid="fresh-tree-generate">GENERATE</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}