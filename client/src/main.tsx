import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

const rawClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const clerkPubKey = rawClerkKey && rawClerkKey.startsWith("pk_") ? rawClerkKey : undefined;
if (rawClerkKey && !clerkPubKey) {
  console.warn("VITE_CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key (must start with pk_). Clerk login disabled.");
}

// If the Clerk publishable key changed since the last visit, purge stale
// Clerk browser state (dev-browser JWTs, client cache) from the old instance,
// otherwise ClerkJS fails to initialize with 401s.
if (clerkPubKey) {
  try {
    const KEY_MARKER = "nwl_clerk_pk_v3";
    if (localStorage.getItem(KEY_MARKER) !== clerkPubKey) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.toLowerCase().includes("clerk") && !k.startsWith("nwl_")) {
          localStorage.removeItem(k);
        }
      }
      const host = window.location.hostname;
      const domains = ["", host, `.${host}`];
      // Also cover parent domains (e.g. .riker.replit.dev)
      const parts = host.split(".");
      for (let i = 1; i < parts.length - 1; i++) {
        domains.push(`.${parts.slice(i).join(".")}`);
      }
      const paths = ["/", ""];
      document.cookie.split(";").forEach((c) => {
        const name = c.split("=")[0].trim();
        if (name.toLowerCase().includes("clerk") || name.startsWith("__client") || name.startsWith("__session")) {
          for (const d of domains) {
            const domainAttr = d ? `; domain=${d}` : "";
            for (const p of paths) {
              const pathAttr = p ? `; path=${p}` : "";
              const base = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0${pathAttr}${domainAttr}`;
              document.cookie = base;
              document.cookie = `${base}; Secure`;
              document.cookie = `${base}; Secure; SameSite=None`;
              document.cookie = `${base}; Secure; SameSite=None; Partitioned`;
            }
          }
        }
      });
      localStorage.setItem(KEY_MARKER, clerkPubKey);
    }
  } catch (e) {
    // localStorage unavailable — ignore
  }
}

createRoot(document.getElementById("root")!).render(
  clerkPubKey ? (
    <ClerkProvider publishableKey={clerkPubKey}>
      <App />
    </ClerkProvider>
  ) : (
    <App />
  )
);
