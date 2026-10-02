import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Version = { id: number; createdAt: string; instructions: string; prose: string; warnings: string[] };

export function ProsifyDialog({ open, onOpenChange, tree, onTreeChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: string;
  onTreeChange: (tree: string) => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [liveProse, setLiveProse] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const request = useRef<AbortController | null>(null);

  const download = (version: Version) => {
    const url = URL.createObjectURL(new Blob([version.prose], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `prosify-version-${version.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (request.current) return;
    if (!tree.trim()) { setError("Paste a numbered tree here"); return; }
    const usedInstructions = instructions;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true); setError(""); setProgress(""); setLiveProse("");
    const pieces: string[] = [];
    try {
      const response = await fetch("/api/prosify", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store",
        signal: controller.signal, body: JSON.stringify({ tree, instructions: usedInstructions }),
      });
      if (!(response.headers.get("content-type") || "").includes("text/event-stream")) {
        throw new Error("Server error: route not reached — restart required");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Prosify returned no response body.");
      const decoder = new TextDecoder(); let buffer = ""; let complete = false; let warnings: string[] = [];
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
          else if (data.type === "error") throw new Error(data.error);
          else if (data.type === "paragraph") {
            pieces.push(`${data.header ? `${data.header}\n` : ""}${data.prose}`);
            setLiveProse(pieces.join("\n\n"));
          } else if (data.type === "complete") { complete = true; warnings = data.warnings || []; }
        }
      }
      if (!complete && !controller.signal.aborted) throw new Error("Server error: route not reached — restart required");
      if (!controller.signal.aborted) {
        const prose = pieces.join("\n\n");
        const id = versions.reduce((maximum, version) => Math.max(maximum, version.id), 0) + 1;
        const version: Version = { id, prose, warnings, instructions: usedInstructions.trim() || "default", createdAt: new Date().toLocaleTimeString() };
        setVersions((old) => [version, ...old]);
        setSelectedId(id); setLiveProse(""); setProgress("");
      }
    } catch (caught: any) {
      if (!controller.signal.aborted) { setError(caught?.message || "Prosification failed."); setLiveProse(""); setProgress(""); }
    } finally {
      if (request.current === controller) { request.current = null; setRunning(false); }
    }
  };

  const selected = versions.find((version) => version.id === selectedId) || versions[0];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="prosify-dialog">
      <DialogHeader><DialogTitle>PROSIFY</DialogTitle></DialogHeader>
      <Label htmlFor="prosify-tree">Tree</Label>
      <Textarea id="prosify-tree" value={tree} onChange={(event) => onTreeChange(event.target.value)} className="min-h-64 font-mono" data-testid="prosify-tree" />
      <Label htmlFor="prosify-instructions">Instructions (optional)</Label>
      <Textarea id="prosify-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)}
        placeholder="Leave blank for standard minimal prosification, or type special requirements." className="min-h-24" data-testid="prosify-instructions" />
      <Button onClick={() => void run()} disabled={running} data-testid="prosify-run">{running ? "PROSIFYING…" : "PROSIFY"}</Button>
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <section>
        <h3 className="font-semibold mb-2">Versions</h3>
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions yet.</p> : <div className="space-y-2">
          {versions.map((version) => <div key={version.id} className={`rounded border p-2 ${selected?.id === version.id ? "border-primary" : ""}`}>
            <button type="button" className="text-left font-medium" onClick={() => setSelectedId(version.id)}>Version {version.id} — {version.createdAt}</button>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">Instructions: {version.instructions}</p>
            <div className="flex gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(version.prose).catch(() => setError(`Copy failed for Version ${version.id}.`))}>Copy</Button>
              <Button size="sm" variant="outline" onClick={() => download(version)}>Download .txt</Button>
            </div>
          </div>)}
        </div>}
      </section>
      {(liveProse || selected) && <section className="rounded border p-4">
        <h3 className="font-semibold mb-2">{liveProse ? "Prosifying…" : `Version ${selected?.id}`}</h3>
        {selected?.warnings?.map((warning) => !liveProse && <p key={warning} className="mb-2 text-sm text-amber-700" role="alert">Warning: {warning}</p>)}
        <div className="whitespace-pre-wrap">{liveProse || selected?.prose}</div>
      </section>}
    </DialogContent>
  </Dialog>;
}
