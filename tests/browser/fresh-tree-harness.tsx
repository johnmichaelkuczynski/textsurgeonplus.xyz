// Test-only host: mount the production dialog without starting Home's unrelated
// providers. Persist the input so a real same-tab reload restores the same book.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FreshTreeDialog } from "../../client/src/components/FreshTreeDialog";
import "../../client/src/index.css";

const BOOK = "CHAPTER 1: Alpha\nAlpha source.\nCHAPTER 2: Beta\nBeta source.\nCHAPTER 3: Gamma\nGamma source.";

function Harness() {
  const [text, setText] = useState(() => sessionStorage.getItem("test-book") ?? BOOK);
  const [open, setOpen] = useState(false);
  return <>
    <label htmlFor="test-source">Book source</label>
    <textarea id="test-source" value={text} onChange={(event) => {
      setText(event.target.value);
      sessionStorage.setItem("test-book", event.target.value);
    }} />
    <button onClick={() => setOpen(true)}>Open Fresh Tree</button>
    <FreshTreeDialog open={open} onOpenChange={setOpen} text={text} selection=""
      onSendToProsify={() => { throw new Error("Unexpected Prosify action in regression"); }} />
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);