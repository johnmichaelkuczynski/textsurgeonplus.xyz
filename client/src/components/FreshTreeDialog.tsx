import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "A" | "B" | "C" | "D";
type Chapter = { index: number; number: number; title: string; wordCount: number };
type Statement = { number: string; text: string; depth: number };
type Source = { node: string; url: string; marker?: string };
type Tree = { index: number; title: string; statements: Statement[]; sources: Source[]; complete: boolean };
const DEFAULT_INSTRUCTIONS = "Under each node, add 1 or 2 child nodes. Each must be a concrete example or fact that illustrates or supports its parent. It must be FRESH: do not use any example, name, case, or illustration from the source text. Prefer real, accurate, current scientific or factual examples; everyday examples are allowed; do not invent fake facts. One sentence per node. No commentary.";
const DEPTH_ERROR = "Depth must be a whole number of 2 or more.";

function parseFreshTreeDepth(value: string): number | null {
  if (!value.trim()) return 2;
  if (!/^\d+$/.test(value.trim())) return null;
  const depth = Number(value.trim());
  return Number.isSafeInteger(depth) && depth >= 2 ? depth : null;
}

export function FreshTreeDialog({ open, onOpenChange, text, selection, onSendToProsify }: { open: boolean; onOpenChange: (open: boolean) => void; text: string; selection: string; onSendToProsify: (tree: string) => void }) {
  const [mode, setMode] = useState<Mode>("A");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [depthInput, setDepthInput] = useState("");
  const [addedInstructions, setAddedInstructions] = useState("");
  const [confirmDepth, setConfirmDepth] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [generatedFor, setGeneratedFor] = useState("");
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const request = useRef<AbortController | null>(null);
  const runId = useRef<string | null>(null);
  const wasOpen = useRef(false);
  const treesRef = useRef<Tree[]>([]);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => { treesRef.current = trees; }, [trees]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

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

  const close = () => { request.current?.abort(); request.current = null; runId.current = null; setRunning(false); onOpenChange(false); };
  const inputKey = JSON.stringify({ text, selection: mode === "D" ? selection : "", mode, chosen: mode === "C" ? [...chosen].sort((a, b) => a - b) : [] });
  const expectedUnits = mode === "B" ? chapters.length : mode === "C" ? chosen.length : 1;
  const estimate = (target: number) => {
    const relevant = generatedFor === inputKey ? trees : [];
    const base = relevant.filter((tree) => tree.statements.some((item) => item.depth === 1));
    const units = base.length || Math.max(expectedUnits, 1);
    const roots = base.length ? base.reduce((sum, tree) => sum + tree.statements.filter((item) => item.depth === 0).length, 0) : units;
    const leaves = base.length ? base.reduce((sum, tree) => sum + tree.statements.filter((item) => item.depth === 1).length, 0) : units * 2;
    const initialNodes = base.length ? base.reduce((sum, tree) => sum + tree.statements.filter((item) => item.depth <= 1).length, 0) : units * 3;
    const thirdTier = target > 2 ? Math.ceil(leaves * 1.5) : 0;
    const nodes = initialNodes + thirdTier * Math.max(0, target - 2);
    const calls = units + roots * Math.max(0, target - 2) * 3;
    return { nodes, calls };
  };
  const stop = async () => {
    if (!runId.current || stopping) return;
    setStopping(true);
    try {
      const response = await fetch("/api/fresh-tree/stop", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ runId: runId.current }),
      });
      if (!response.ok) throw new Error("Could not stop the current run.");
      setProgress("Stopping after the current model call…");
    } catch (error: any) {
      setStopping(false);
      setErrors((old) => [...old, error.message || "Could not stop the current run."]);
    }
  };
  const run = async (action: "generate" | "next", confirmed = false) => {
    if (request.current) return;
    if (mode === "D" && !selection) { setErrors(["Highlight text in the main text box first"]); return; }
    if (mode === "C" && !chosen.length) { setErrors(["Tick at least one detected chapter."]); return; }
    const target = action === "generate" ? parseFreshTreeDepth(depthInput) : 2;
    if (target === null) { setErrors([DEPTH_ERROR]); return; }
    if (action === "generate" && target > 6 && !confirmed) { setConfirmDepth(target); setErrors([]); return; }
    setConfirmDepth(null);
    const controller = new AbortController();
    const id = crypto.randomUUID();
    request.current = controller; runId.current = id; setRunning(true); setElapsed(0); setStopping(false); setErrors([]); setProgress(""); setProviderStatuses([]);
    if (action === "generate") { setTrees([]); setWarnings([]); setGeneratedFor(inputKey); }
    try {
      const response = await fetch("/api/fresh-tree", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ text, selection, mode, indices: chosen, action, instructions, depth: target, addedInstructions, runId: id,
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
           else if (data.type === "provider-status") setProviderStatuses((old) => [...old, data.message]);
          else if (data.type === "chapter-error") setErrors((old) => [...old, `${data.title}: ${data.error}`]);
          else if (data.type === "node-warning") setWarnings((old) => [...old, data.message]);
          else if (data.type === "stopped") setProgress("Stopped. All output shown so far has been kept; use Download .txt to save it.");
          else if (data.type === "error") throw new Error(data.error);
          else if (data.type === "complete") completed = true;
          else if (data.type === "tree" || data.type === "tier" || data.type === "chapter-complete") setTrees((old) => {
            const found = old.find((tree) => tree.index === data.index);
            if (!found && data.type === "chapter-complete") return old;
            const updated: Tree = found ? { ...found, statements: [...found.statements], sources: [...found.sources] }
              : { index: data.index, title: data.title, statements: [], sources: [], complete: false };
            if (data.type === "tree" && !updated.statements.length) updated.statements = data.statements;
            if (data.type === "tier") {
              updated.complete = false;
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
      if (!controller.signal.aborted) setProgress((current) => current.startsWith("Stopped.") ? current : "");
    } catch (error: any) { if (!controller.signal.aborted) setErrors((old) => [...old, error.message || "Fresh Tree failed."]); }
    finally { if (request.current === controller) { request.current = null; runId.current = null; setRunning(false); setStopping(false); } }
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
    const sources = tree.sources.length ? `\n\nSources\n${tree.sources.map((item) => `${item.marker ? `${item.marker} ` : ""}(${item.node}) — ${item.url}`).join("\n")}` : "";
    return heading + body + sources;
  }).join("\n\n");
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = "fresh-tree.txt"; link.click();
    URL.revokeObjectURL(url);
  };
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
      <div className="space-y-2">
        <Label htmlFor="fresh-tree-depth">Depth (optional)</Label>
        <Input id="fresh-tree-depth" type="text" inputMode="numeric" value={depthInput}
          onChange={(event) => { setDepthInput(event.target.value); setConfirmDepth(null); }}
          placeholder="Blank = 2 tiers" disabled={running} data-testid="fresh-tree-depth" />
        <p className="text-xs text-muted-foreground" data-testid="fresh-tree-estimate">
          {generatedFor === inputKey && trees.some((tree) => tree.statements.some((item) => item.depth === 1))
            ? `Estimated size: ~${estimate(parseFreshTreeDepth(depthInput) || 2).nodes} nodes, ~${estimate(parseFreshTreeDepth(depthInput) || 2).calls} model calls.`
            : "Estimated size shown after tiers 1–2 are built."}
        </p>
        <div className="flex flex-wrap gap-1" aria-label="Choose depth">
          {[2, 3, 4, 5, 6].map((choice) =>
            <Button key={choice} size="sm" type="button" variant={depthInput === String(choice) ? "default" : "outline"}
              disabled={running} onClick={() => { setDepthInput(String(choice)); setConfirmDepth(null); }} data-testid={`fresh-tree-depth-${choice}`}>
              {choice} tiers
            </Button>)}
        </div>
        <Label htmlFor="fresh-tree-added-instructions">Instructions for added tiers (optional)</Label>
        <Textarea id="fresh-tree-added-instructions" value={addedInstructions} onChange={(event) => setAddedInstructions(event.target.value)}
          placeholder="Blank = default fresh-node rules" disabled={running} data-testid="fresh-tree-added-instructions" />
      </div>
      {confirmDepth !== null && <div className="rounded border p-3 text-sm" role="alertdialog" aria-label="Confirm depth" data-testid="fresh-tree-depth-confirm">
        <p>Depth {confirmDepth} will produce roughly {estimate(confirmDepth).nodes} nodes and take several minutes. Continue?</p>
        <div className="flex gap-2 mt-2">
          <Button type="button" onClick={() => void run("generate", true)}>Continue</Button>
          <Button type="button" variant="outline" onClick={() => setConfirmDepth(null)}>Cancel</Button>
        </div>
      </div>}
      {running && <div className="sticky top-0 z-10 rounded border border-blue-200 bg-blue-50 p-2 text-sm" role="status" aria-live="polite">
        <span className="inline-block size-2 rounded-full bg-blue-600 animate-pulse mr-2" aria-hidden="true" />
        {stopping ? "Stopping…" : "Fresh Tree is running"} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed
        {progress && <span className="block mt-1">{progress}</span>}
        <span className="block mt-1">{trees.filter((tree) => tree.complete).length} of {expectedUnits} chapters finished · {trees.reduce((sum, tree) => sum + tree.statements.length, 0)} nodes received</span>
        <div className="flex gap-2 mt-2">
          {output && <Button type="button" size="sm" variant="outline" onClick={download}>Save output so far</Button>}
          <Button type="button" size="sm" variant="destructive" disabled={stopping} onClick={() => void stop()}>{stopping ? "STOPPING…" : "STOP"}</Button>
        </div>
      </div>}
      {!running && progress && <p className="text-sm" role="status">{progress}</p>}
      {providerStatuses.map((status, index) => <p key={`${index}-${status}`} className="text-amber-900 text-sm" role="status">{status}</p>)}
      {errors.map((error, index) => <p key={`${index}-${error}`} className="text-red-700 text-sm" role="alert">{error}</p>)}
      {trees.length > 0 && <div className="rounded border border-yellow-300 bg-yellow-50 p-3" data-testid="fresh-tree-results">
        <pre ref={outputRef} className="whitespace-pre-wrap break-words text-sm max-h-[45vh] overflow-y-auto" aria-live="polite">{output}</pre>
        {warnings.length > 0 && <div className="max-h-32 overflow-y-auto mt-2" aria-label={`${warnings.length} node warnings`}>
          {warnings.map((warning, index) => <p key={`${index}-${warning}`} className="text-amber-900 text-sm mt-2">{warning}</p>)}
        </div>}
        <div className="flex gap-2 mt-3"><Button variant="outline" onClick={() => void navigator.clipboard.writeText(output).catch(() => setErrors((old) => [...old, "Copy failed."]))}>Copy</Button>
          <Button variant="outline" onClick={download}>Download .txt</Button></div>
        <p className="mt-4 font-medium">Current depth: {depth} tiers</p>
        <Label htmlFor="fresh-tree-instructions">Instructions for the new nodes</Label>
        <Textarea id="fresh-tree-instructions" className="mt-1 min-h-28 bg-white" value={instructions} onChange={(event) => setInstructions(event.target.value)} disabled={running} />
        <div className="flex gap-2 mt-3">
          <Button disabled={running || !trees.some((tree) => tree.complete)} onClick={() => void run("next")} data-testid="fresh-tree-next">ADD NEXT TIER</Button>
          <Button variant="outline" disabled={running} onClick={() => onSendToProsify(output)} data-testid="fresh-tree-send-prosify">→ SEND TO PROSIFY</Button>
        </div>
      </div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={close} data-testid="fresh-tree-cancel">CANCEL</Button>
        {running && <Button variant="destructive" onClick={() => void stop()} disabled={stopping} data-testid="fresh-tree-stop">{stopping ? "STOPPING…" : "STOP"}</Button>}
        <Button onClick={() => void run("generate")} disabled={running || ((mode === "B" || mode === "C") && (loadingChapters || !chapters.length))} data-testid="fresh-tree-generate">GENERATE</Button></div>
    </DialogContent>
  </Dialog>;
}
