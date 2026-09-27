import suppliedPresets from "@assets/Pasted-1-Rewrite-in-style-of-sample-matching-its-average-sente_1790536760856.txt?raw";

export const humanizerStylePresets = suppliedPresets
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const numberedInstruction = /^(\d+)\.\s+(.+)$/.exec(line);
    if (!numberedInstruction) throw new Error("A supplied style preset has no number or instruction.");
    const [, id, instruction] = numberedInstruction;
    const shortLabel = instruction
      .replace(/^Rewrite in style of sample,\s*/i, "")
      .replace(/\.$/, "");

    return {
      id,
      label: `${id}. ${shortLabel.charAt(0).toUpperCase()}${shortLabel.slice(1)}`,
      instruction,
    };
  });