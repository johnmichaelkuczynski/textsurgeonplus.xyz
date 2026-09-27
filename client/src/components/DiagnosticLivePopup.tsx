import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type DiagnosticTrace = {
  id: string;
  label: string;
  status: "running" | "passed" | "failed" | "stopped";
  events: string[];
  output?: string;
};

export function DiagnosticLivePopup({
  trace, onClose, onStop, canStop,
}: {
  trace: DiagnosticTrace | null;
  onClose: () => void;
  onStop: () => void;
  canStop: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!trace || trace.status !== "running") return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [trace?.id, trace?.status]);
  useEffect(() => {
    if (trace?.status === "running") bottom.current?.scrollIntoView({ block: "nearest" });
  }, [trace?.output, trace?.events.length, trace?.status]);
  return (
    <Dialog open={!!trace} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[min(85vh,42rem)] w-[min(94vw,52rem)] max-w-[52rem] flex-col">
        <DialogHeader>
          <DialogTitle>{trace?.label || "Diagnostic output"}</DialogTitle>
          <DialogDescription>
            {trace?.status === "running"
              ? `Live request · ${elapsed}s elapsed. Provider prose appears below as genuine streamed chunks when this endpoint supports them.`
              : trace?.status === "passed" ? "Passed with the evidence below." : trace?.status === "stopped" ? "Stopped by user. No further results will be accepted." : "Failed or not verified; see the reason below."}
          </DialogDescription>
          {canStop ? (
            <Button type="button" variant="destructive" size="sm" className="self-start" onClick={onStop}>
              Stop all diagnostics now
            </Button>
          ) : null}
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-slate-50 p-4">
          <div role="log" aria-live="polite" className="space-y-2 text-sm">
            {trace?.events.map((event, index) => (
              <p key={index} className="whitespace-pre-wrap break-words font-mono text-xs text-slate-700">{event}</p>
            ))}
            {trace?.status === "running" && !trace.output ? (
              <p className="font-semibold text-blue-800">Waiting for the live request; no generated text has arrived yet.</p>
            ) : null}
          </div>
          {trace?.output ? (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 font-semibold">{trace.status === "stopped" ? "Partial response (not verified)" : "Actual response"}</p>
              <div className="whitespace-pre-wrap break-words font-serif text-sm leading-relaxed">{trace.output}</div>
            </div>
          ) : null}
          <div ref={bottom} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}