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

function getConfiguration() {
  const credentialName = "GENIUS_API_KEY";
  const credential = process.env[credentialName] || "";
  const baseUrl = (process.env.GENIUS_101_API_BASE_URL || "").trim();
  const searchPath = (process.env.GENIUS_101_SEARCH_PATH || "").trim();
  const authHeader = (process.env.GENIUS_101_AUTH_HEADER || "").trim();
  const authScheme = process.env.GENIUS_101_AUTH_SCHEME ?? "";
  const missing: string[] = [];
  if (!credential) missing.push(credentialName);
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
  const config = getConfiguration();
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
): Promise<CorpusPassage[]> {
  const config = getConfiguration();
  if (config.missing.length) {
    throw new Error(`Genius 101 corpus access is not configured: missing ${config.missing.join(", ")}`);
  }

  const url = new URL(config.searchPath, config.baseUrl);
  const controller = new AbortController();
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
    if (error?.name === "AbortError") throw new Error("Genius 101 corpus request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function diagnoseGenius101(thinker: string): Promise<Genius101Status> {
  const status = getGenius101Status(thinker);
  if (!status.configuration.ready) return status;
  try {
    const passages = await searchGenius101(thinker, thinker, 1);
    return {
      ...status,
      access: {
        ok: true,
        passageCount: passages.length,
        message: passages.length ? "Credential and corpus search succeeded" : "Credential succeeded; no test passage was returned",
      },
    };
  } catch (error: any) {
    return {
      ...status,
      access: { ok: false, message: error?.message || "Corpus access failed" },
    };
  }
}
