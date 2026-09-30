import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Mode = "A" | "B" | "C" | "D";
type Chapter = { index: number; number: number; title: string; wordCount: number };
type Statement = { number: string; text: string; depth: number };
type Source = { node: string; url: string };
type Tree = { index: number; title: string; statements: Statement[]; sources: Source[]; complete: boolean };
const DEFAULT_INSTRUCTIONS = "Under each node, add 1 or 2 child nodes. Each must be a concrete example or fact that illustrates or supports its parent. It must be FRESH: do not use any example, name, case, or illustration from the source text. Prefer real, accurate, current scientific or factual examples; everyday examples are allowed; do not invent fake facts. One sentence per node. No commentary.";

export function FreshTreeDialog({ open, onOpenChange, text, selection }: { open: boolean; onOpenChange: (open: boolean) => void; text: string; selection: string }) {
  const [mode, setMode] = useState<Mode>("A");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [running, setRunning] = useState(false);
  const request = useRef<AbortController | null>(null);
  const wasOpen = useRef(false);
  const treesRef = useRef<Tree[]>([]);

  useEffect(() => { treesRef.current = trees; }, [trees]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      if (!treesRef.current.length) setMode(selection ? "D" : "A");
      setErrors([]);
      setProgress("");
    } else if (!open) request.current?.abort();
    wasOpen.current = open;
    // Selection can change when focus moves into the dialog. It must never
    // reinitialize the session or erase tiers that have already been shown.
  }, [open]);

  useEffect(() => {
    if (!open || (mode !== "B" && mode !== "C")) return;
    const controller = new AbortController();
    setLoadingChapters(true); setChapters([]);
    fetch("/api/fresh-tree/chapters", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ text }), signal: controller.signal })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) throw new Error("Server error: route not reached — restart required");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Chapter detection failed.");
        setChapters(data.chapters); setErrors(data.chapters.length ? [] : ["No body chapters were detected. Check the chapter headings."]);
      }).catch((error) => { if (!controller.signal.aborted) setErrors([error.message || "Chapter detection failed."]); })
      .finally(() => { if (!controller.signal.aborted) setLoadingChapters(false); });
    return () => controller.abort();
  }, [open, mode, text]);

  const close = () => { request.current?.abort(); request.current = null; setRunning(false); onOpenChange(false); };
  const run = async (action: "generate" | "next") => {
    if (request.current) return;
    if (mode === "D" && !selection) { setErrors(["Highlight text in the main text box first"]); return; }
    if (mode === "C" && !chosen.length) { setErrors(["Tick at least one detected chapter."]); return; }
    const controller = new AbortController(); request.current = controller; setRunning(true); setErrors([]); setProgress("");
    if (action === "generate") setTrees([]);
    try {
      const response = await fetch("/api/fresh-tree", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ text, selection, mode, indices: chosen, action, instructions,
          trees: action === "next" ? trees.filter((tree) => tree.complete).map(({ index, statements }) => ({ index, statements })) : undefined }) });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) throw new Error("Server error: route not reached — restart required");
      if (!response.ok) throw new Error(`Fresh Tree request failed (${response.status}).`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Fresh Tree returned no response body.");
      const decoder = new TextDecoder(); let buffer = ""; let completed = false;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "progress") setProgress(data.message);
          else if (data.type === "chapter-error") setErrors((old) => [...old, `${data.title}: ${data.error}`]);
          else if (data.type === "error") throw new Error(data.error);
          else if (data.type === "complete") completed = true;
          else if (data.type === "tree" || data.type === "tier" || data.type === "chapter-complete") setTrees((old) => {
            const found = old.find((tree) => tree.index === data.index);
            if (!found && data.type === "chapter-complete") return old;
            const updated: Tree = found ? { ...found, statements: [...found.statements], sources: [...found.sources] }
              : { index: data.index, title: data.title, statements: [], sources: [], complete: false };
            if (data.type === "tree" && !updated.statements.length) updated.statements = data.statements;
            if (data.type === "tier") {
              const existingNumbers = new Set(updated.statements.map((statement) => statement.number));
              updated.statements.push(...data.statements.filter((statement: Statement) => !existingNumbers.has(statement.number)));
              const existingSources = new Set(updated.sources.map((source) => `${source.node}\n${source.url}`));
              updated.sources.push(...data.sources.filter((source: Source) => !existingSources.has(`${source.node}\n${source.url}`)));
            }
            if (data.type === "chapter-complete") updated.complete = true;
            return [...old.filter((tree) => tree.index !== data.index), updated].sort((a, b) => a.index - b.index);
          });
        }
      }
      if (!completed && !controller.signal.aborted) throw new Error("Server error: route not reached — restart required");
      setProgress("");
    } catch (error: any) { if (!controller.signal.aborted) setErrors((old) => [...old, error.message || "Fresh Tree failed."]); }
    finally { if (request.current === controller) { request.current = null; setRunning(false); } }
  };

  const ordered = (items: Statement[]) => [...items].sort((a, b) => {
    const aa = a.number.split(".").map(Number), bb = b.number.split(".").map(Number);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) { if ((aa[i] ?? -1) !== (bb[i] ?? -1)) return (aa[i] ?? -1) - (bb[i] ?? -1); }
    return 0;
  });
  const output = trees.map((tree) => {
    const chapter = chapters.find((item) => item.index === tree.index);
    const heading = mode === "B" || mode === "C" ? `CHAPTER ${chapter?.number ?? tree.index + 1}: ${tree.title.replace(/^chapter\s+(?:\d+|[ivxlcdm]+|[a-z]+)\s*[:.—–-]?\s*/i, "") || "Untitled"}\n` : "";
    const body = ordered(tree.statements).map((item) => `${item.number} ${item.text}`).join("\n");
    const sources = tree.sources.length ? `\n\nSources\n${tree.sources.map((item) => `${item.node} — ${item.url}`).join("\n")}` : "";
    return heading + body + sources;
  }).join("\n\n");
  const depth = trees.length ? Math.max(...trees.flatMap((tree) => tree.statements.map((item) => item.depth + 1))) : 0;

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto [&>button]:hidden" data-testid="fresh-tree-dialog">
      <DialogHeader><DialogTitle>FRESH TREE</DialogTitle></DialogHeader>
      <RadioGroup value={mode} onValueChange={(value) => { if (!running) { setMode(value as Mode); setErrors([]); } }}>
        {[["A", "Whole book — one tree"], ["B", "Whole book — each chapter gets its own tree"], ["C", "Selected chapters — each gets its own tree"], ["D", "Manual select"]].map(([value, label]) =>
          <label key={value} className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value={value} disabled={running} data-testid={`fresh-tree-mode-${value}`} />{label}</label>)}
      </RadioGroup>
      {(mode === "B" || mode === "C") && <div className="max-h-44 overflow-y-auto rounded border p-3" data-testid="fresh-tree-chapters">
        {loadingChapters ? "Detecting chapters…" : chapters.map((chapter) => <label key={chapter.index} className="flex items-center gap-2 py-1 text-sm">
          {mode === "C" && <Checkbox checked={chosen.includes(chapter.index)} disabled={running} onCheckedChange={(checked) => setChosen((old) => checked ? [...old, chapter.index] : old.filter((index) => index !== chapter.index))} data-testid={`fresh-tree-chapter-${chapter.index}`} />}
          {chapter.number}. {chapter.title} ({chapter.wordCount} words)</label>)}</div>}
      {mode === "D" && !selection && <p className="text-red-700 text-sm" role="alert">Highlight text in the main text box first</p>}
      {progress && <p className="text-sm" role="status">{progress}</p>}
      {errors.map((error, index) => <p key={`${index}-${error}`} className="text-red-700 text-sm" role="alert">{error}</p>)}
      {trees.length > 0 && <div className="rounded border border-yellow-300 bg-yellow-50 p-3" data-testid="fresh-tree-results">
        <pre className="whitespace-pre-wrap break-words text-sm">{output}</pre>
        <div className="flex gap-2 mt-3"><Button variant="outline" onClick={() => void navigator.clipboard.writeText(output).catch(() => setErrors((old) => [...old, "Copy failed."]))}>Copy</Button>
          <Button variant="outline" onClick={() => { const url = URL.createObjectURL(new Blob([output], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = "fresh-tree.txt"; link.click(); URL.revokeObjectURL(url); }}>Download .txt</Button></div>
        <p className="mt-4 font-medium">Current depth: {depth} tiers</p>
        <Label htmlFor="fresh-tree-instructions">Instructions for the new nodes</Label>
        <Textarea id="fresh-tree-instructions" className="mt-1 min-h-28 bg-white" value={instructions} onChange={(event) => setInstructions(event.target.value)} disabled={running} />
        <Button className="mt-3" disabled={running || !trees.some((tree) => tree.complete)} onClick={() => void run("next")} data-testid="fresh-tree-next">ADD NEXT TIER</Button>
      </div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={close} data-testid="fresh-tree-cancel">CANCEL</Button>
        <Button onClick={() => void run("generate")} disabled={running || ((mode === "B" || mode === "C") && (loadingChapters || !chapters.length))} data-testid="fresh-tree-generate">GENERATE</Button></div>
    </DialogContent>
  </Dialog>;
}
