export interface FreshTreeChapterProgress {
  baseComplete: boolean;
  targetDepth: number;
  completedDepth: number;
  tiers: Record<string, { completedTheses: string[]; complete: boolean }>;
}