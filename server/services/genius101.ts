type CorpusPassage = {
  text: string;
  title: string;
  author?: string;
  locator?: string;
  url?: string;
};

export type Genius101Status = {
  thinker: string;
  credential: { configured: boolean; name: string };
  configuration: {
    ready: boolean;
    missing: string[];
    baseUrlConfigured: boolean;
    searchPathConfigured: boolean;
    authHeaderConfigured: boolean;
  };
  access?: { ok: boolean; message: string; passageCount?: number };
};

const THINKER_KEYS: Record<string, string> = {
  "Adam Smith": "ADAM_SMITH_API_KEY",
  Adler: "ADLER_API_KEY",
  Aesop: "AESOP_API_KEY",
  Allen: "ALLEN_API_KEY",
  Aristotle: "ARISTOTLE_API_KEY",
  Bacon: "BACON_API_KEY",
  Bergler: "BERGLER_API_KEY",
  Bergson: "BERGSON_API_KEY",
  Berkeley: "BERKELEY_API_KEY",
  Confucius: "CONFUCIUS_API_KEY",
  Darwin: "DARWIN_API_KEY",
  Descartes: "DESCARTES_API_KEY",
  Dewey: "DEWEY_API_KEY",
  Dworkin: "DWORKIN_API_KEY",
  "Emma Goldman": "EMMA_GOLDMAN_API_KEY",
  Engels: "ENGELS_API_KEY",
  Freud: "FREUD_API_KEY",
  Galileo: "GALILEO_API_KEY",
  Gardner: "GARDNER_API_KEY",
  Hegel: "HEGEL_API_KEY",
  Hobbes: "HOBBES_API_KEY",
  Hume: "HUME_API_KEY",
  Jung: "JUNG_API_KEY",
  Kant: "KANT_API_KEY",
  Kernberg: "KERNBERG_API_KEY",
  Kuczynski: "KUCZYNSKI_API_KEY",
  "La Rochefoucauld": "LA_ROCHEFOUCAULD_API_KEY",
  Laplace: "LAPLACE_API_KEY",
  "Le Bon": "LEBON_API_KEY",
  Leibniz: "LEIBNIZ_API_KEY",
  Locke: "LOCKE_API_KEY",
  Luther: "LUTHER_API_KEY",
  Machiavelli: "MACHIAVELLI_API_KEY",
  Maimonides: "MAIMONIDES_API_KEY",
  Marden: "MARDEN_API_KEY",
  Marx: "MARX_API_KEY",
  Mill: "MILL_API_KEY",
  Nietzsche: "NIETZSCHE_API_KEY",
  Peirce: "PEIRCE_API_KEY",
  Plato: "PLATO_API_KEY",
  "Poincaré": "POINCARE_API_KEY",
  Popper: "POPPER_API_KEY",
  Rousseau: "ROUSSEAU_API_KEY",
  Sartre: "SARTRE_API_KEY",
  Schopenhauer: "SCHOPENHAUER_API_KEY",
  Spencer: "SPENCER_API_KEY",
  Stekel: "STEKEL_API_KEY",
  Tocqueville: "TOCQUEVILLE_API_KEY",
  Veblen: "VEBLEN_API_KEY",
  Weyl: "WEYL_API_KEY",
  Whewell: "WHEWELL_API_KEY",
  "William James": "WILLIAM_JAMES_API_KEY",
};

function getConfiguration(thinker: string) {
  const credentialName = THINKER_KEYS[thinker] || "";
  const credential = credentialName ? process.env[credentialName] || "" : "";
  const baseUrl = (process.env.GENIUS_101_API_BASE_URL || "").trim();
  const searchPath = (process.env.GENIUS_101_SEARCH_PATH || "").trim();
  const authHeader = (process.env.GENIUS_101_AUTH_HEADER || "").trim();
  const authScheme = process.env.GENIUS_101_AUTH_SCHEME ?? "";
  const missing: string[] = [];
  if (!credentialName) missing.push(`No author-specific credential registered for ${thinker}`);
  else if (!credential) missing.push(credentialName);
  if (!baseUrl) missing.push("GENIUS_101_API_BASE_URL");
  if (!searchPath) missing.push("GENIUS_101_SEARCH_PATH");
  if (!authHeader) missing.push("GENIUS_101_AUTH_HEADER");
  return { credentialName, credential, baseUrl, searchPath, authHeader, authScheme, missing };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePassage(item: any): CorpusPassage | null {
  if (typeof item === "string") {
    return item.trim() ? { text: item.trim(), title: "Genius 101 corpus" } : null;
  }
  if (!item || typeof item !== "object") return null;
  const text = asString(item.text) || asString(item.content) || asString(item.passage) || asString(item.chunk);
  if (!text) return null;
  return {
    text,
    title:
      asString(item.title) ||
      asString(item.source?.title) ||
      asString(item.work) ||
      asString(item.document) ||
      "Genius 101 corpus",
    author: asString(item.author) || asString(item.source?.author),
    locator:
      asString(item.locator) ||
      asString(item.page) ||
      asString(item.section) ||
      asString(item.source?.locator),
    url: asString(item.url) || asString(item.source?.url),
  };
}

function extractPassages(payload: any): CorpusPassage[] {
  const candidates =
    (Array.isArray(payload) && payload) ||
    payload?.passages ||
    payload?.results ||
    payload?.matches ||
    payload?.data?.passages ||
    payload?.data?.results ||
    payload?.data?.matches;
  if (!Array.isArray(candidates)) {
    throw new Error("The Genius 101 response did not contain a supported passage array");
  }
  return candidates.map(normalizePassage).filter((item: CorpusPassage | null): item is CorpusPassage => !!item);
}

export function getGenius101Status(thinker: string): Genius101Status {
  const config = getConfiguration(thinker);
  return {
    thinker,
    credential: { configured: !!config.credential, name: config.credentialName },
    configuration: {
      ready: config.missing.length === 0,
      missing: config.missing,
      baseUrlConfigured: !!config.baseUrl,
      searchPathConfigured: !!config.searchPath,
      authHeaderConfigured: !!config.authHeader,
    },
  };
}

export async function searchGenius101(
  thinker: string,
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<CorpusPassage[]> {
  signal?.throwIfAborted();
  const config = getConfiguration(thinker);
  if (config.missing.length) {
    throw new Error(`Genius 101 corpus access is not configured: missing ${config.missing.join(", ")}`);
  }

  const url = new URL(config.searchPath, config.baseUrl);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [config.authHeader]: `${config.authScheme}${config.credential}`,
      },
      body: JSON.stringify({ thinker, query, limit }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Genius 101 corpus request failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    return extractPassages(payload).slice(0, limit);
  } catch (error: any) {
    if (signal?.aborted) throw error;
    if (error?.name === "AbortError") throw new Error("Genius 101 corpus request timed out");
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(timeout);
  }
}

export async function diagnoseGenius101(thinker: string, signal?: AbortSignal): Promise<Genius101Status> {
  const status = getGenius101Status(thinker);
  if (!status.configuration.ready) return status;
  try {
    const passages = await searchGenius101(thinker, thinker, 1, signal);
    return {
      ...status,
      access: {
        ok: passages.length > 0,
        passageCount: passages.length,
        message: passages.length ? "Credential and corpus search succeeded" : "Request succeeded; no passage was returned, so corpus access is unverified",
      },
    };
  } catch (error: any) {
    return {
      ...status,
      access: { ok: false, message: error?.message || "Corpus access failed" },
    };
  }
}
