import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TractatusReplacementControls({ tree, provider, disabled, onReplaced, onBusyChange }: {
  tree: { columns: { number: string; text: string; depth: number }[][]; maxDepth: number; totalStatements: number;
    replacementToken?: string; nextReplacementLevel?: number | null; replacementUnavailableReason?: string };
  provider: string;
  disabled: boolean;
  onReplaced: (tree: any) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const report: any[] = (tree as typeof tree & { replacements?: any[] }).replacements ?? [];
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => {
    request.current?.abort();
    onBusyChange(false);
  }, [onBusyChange]);
  const deepest = tree.maxDepth + 1;
  const level = tree.nextReplacementLevel ?? deepest;
  const run = async () => {
    if (request.current || disabled || !tree.replacementToken || level < 3) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); onBusyChange(true); setError(""); setProgress("Starting replacement…");
    try {
      const response = await fetch("/api/tractatus-tree/replace-level", {
        method: "POST", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree, level, provider, instructions }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Replacement failed.");
      if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("The server returned an unexpected response.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No replacement stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      let result: any = null;
      const consume = (event: string) => {
        const line = event.split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const data = JSON.parse(line.slice(6));
        if (data.type === "error") throw new Error(data.error);
        if (data.type === "progress") setProgress(data.message);
        if (data.type === "complete") result = data.result;
      };
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        events.forEach(consume);
        if (done) { if (buffer.trim()) consume(buffer); break; }
      }
      if (controller.signal.aborted) return;
      if (!result?.columns || !result.replacementToken) throw new Error("Replacement ended before a complete reviewed result was received.");
      onReplaced(result);
      setProgress(`Level ${level} replaced. ${result.nextReplacementLevel ? `Level ${result.nextReplacementLevel} is next.` : "This replacement pass is complete."}`);
    } catch (caught: any) {
      if (!controller.signal.aborted) setError(`${caught.message} No changes were applied.`);
      else setProgress("Replacement stopped. The original tree is unchanged.");
    } finally {
      if (request.current === controller) {
        request.current = null; setBusy(false); onBusyChange(false);
      }
    }
  };
  return <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-3" data-testid="tractatus-replacement-controls">
    <p className="font-semibold text-sm">Replace subordinate material</p>
    <p className="text-xs text-yellow-900">
      Levels 1 and 2 are locked. Replace one level at a time, from the deepest upward.
      Each replacement must support its immediate parent and remain aligned with existing children.
      The old material is replaced, not appended.
    </p>
    <p className="text-xs text-muted-foreground">
      Your selected LLM generates the new material. A separate Claude review checks its novelty and parent/child support.
      If any replacement fails review, the entire level stays unchanged.
    </p>
    <Label htmlFor="tractatus-replacement-instructions">Optional requirements or supporting evidence</Label>
    <Textarea id="tractatus-replacement-instructions" value={instructions} disabled={busy}
      onChange={(event) => setInstructions(event.target.value)}
      placeholder="For example: use a fresh argument, proof, evidence, data, or a vivid explanation." />
    <div className="flex gap-2">
      <Button onClick={() => void run()} disabled={disabled || busy || !tree.replacementToken || level < 3}
        data-testid="button-replace-tractatus-level">
        {busy ? `Replacing Level ${level}…` : `Replace Level ${level}${tree.nextReplacementLevel === null ? " Again" : ""}`}
      </Button>
      {busy && <Button variant="outline" onClick={() => request.current?.abort()}>Stop replacement</Button>}
    </div>
    {!tree.replacementToken && <p className="text-xs">{tree.replacementUnavailableReason || "Generate a new tree to enable level replacement."}</p>}
    {progress && <p className="text-sm" role="status">{progress}</p>}
    {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    {report.length > 0 && <details>
      <summary className="cursor-pointer text-xs font-medium">View replacements and support review</summary>
      <div className="space-y-3 mt-2 text-xs">
        {report.map((item) => <div key={item.number} className="border-t border-yellow-200 pt-2">
          <p className="font-semibold">{item.number} → supports {item.parentNumber}</p>
          <p>Previous: {item.previousText}</p>
          <p>Replacement: {item.text}</p>
          <p className="text-muted-foreground">Review: {item.reason}</p>
        </div>)}
      </div>
    </details>}
  </section>;
}