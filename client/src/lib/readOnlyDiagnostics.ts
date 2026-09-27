export type CheckEvidence = {
  evidence: string;
  httpStatus?: number;
  degradedReason?: string;
};

type ReadOnlyDiagnosticCaseDefinition = {
  id: string;
  label: string;
  path: string;
};

export const READ_ONLY_DIAGNOSTIC_CASES = [
  { id: "corpus-authors", label: "Corpus authors", path: "/api/corpus/authors" },
  { id: "corpus-stats", label: "Corpus statistics", path: "/api/corpus/stats" },
  { id: "positions", label: "Philosophical positions", path: "/api/positions" },
  { id: "history", label: "Analysis history lookup", path: "/api/history" },
  { id: "stylometric-authors", label: "Stylometric authors lookup", path: "/api/stylometrics/authors" },
] as const satisfies readonly ReadOnlyDiagnosticCaseDefinition[];

export type ReadOnlyDiagnosticCase = (typeof READ_ONLY_DIAGNOSTIC_CASES)[number];

export type UncoveredHighImpactCategory = {
  category: string;
  reason: string;
};

export const UNCOVERED_HIGH_IMPACT_CATEGORIES: readonly UncoveredHighImpactCategory[] = [
  {
    category: "Credits and payment operations",
    reason: "The credits GET route calls getOrCreateVisitorUser, so even a GET diagnostic can create or change account state; checkout and payment operations are also outside read-only checks.",
  },
  {
    category: "Book-database access and CRUD",
    reason: "The book-databases GET route also calls getOrCreateVisitorUser, while its related save and CRUD routes write user data.",
  },
  {
    category: "Destructive or mutating CRUD",
    reason: "Create, update, delete, batch-write, and other mutation routes cannot be exercised without changing application data.",
  },
  {
    category: "Long-running text or media generation",
    reason: "Several generation paths remain outside these checks. The main-page analysis, workshop rewrite, and audio tests cover only their named routes, not every generation workflow.",
  },
];

export type CheckEvidenceError = Error & { httpStatus?: number };

function diagnosticUsername(): string {
  return `readonly-diagnostic-${globalThis.crypto.randomUUID()}`;
}

function endpointUrl(testCase: ReadOnlyDiagnosticCase): string {
  if (testCase.id === "history" || testCase.id === "stylometric-authors") {
    const url = new URL(testCase.path, window.location.origin);
    url.searchParams.set("username", diagnosticUsername());
    return `${url.pathname}${url.search}`;
  }
  return testCase.path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string, httpStatus?: number): never {
  const error = new Error(message) as CheckEvidenceError;
  if (httpStatus !== undefined) error.httpStatus = httpStatus;
  throw error;
}

export async function checkReadOnlyEndpoint(
  testCase: ReadOnlyDiagnosticCase,
  signal: AbortSignal,
): Promise<CheckEvidence> {
  const response = await fetch(endpointUrl(testCase), {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    fail(`${testCase.label} diagnostic failed (HTTP ${response.status}).`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    fail(`${testCase.label} endpoint did not return valid JSON (HTTP ${response.status}).`, response.status);
  }

  switch (testCase.id) {
    case "corpus-authors":
      if (!Array.isArray(payload)) fail("Corpus authors endpoint returned an unexpected JSON shape.", response.status);
      break;
    case "corpus-stats":
      if (
        !isRecord(payload) ||
        typeof payload.totalAuthors !== "number" ||
        !Number.isFinite(payload.totalAuthors) ||
        typeof payload.totalWorks !== "number" ||
        !Number.isFinite(payload.totalWorks) ||
        typeof payload.totalWords !== "number" ||
        !Number.isFinite(payload.totalWords) ||
        !Array.isArray(payload.authors)
      ) {
        fail("Corpus statistics endpoint returned an unexpected JSON shape.", response.status);
      }
      break;
    case "positions":
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.positions) ||
        typeof payload.count !== "number" ||
        !Number.isInteger(payload.count)
      ) {
        fail("Positions endpoint returned an unexpected JSON shape.", response.status);
      }
      break;
    case "history":
    case "stylometric-authors": {
      const listKey = testCase.id === "history" ? "history" : "authors";
      if (!isRecord(payload) || !Array.isArray(payload[listKey])) {
        fail(`${testCase.label} endpoint returned an unexpected JSON shape.`, response.status);
      }
      break;
    }
  }

  return {
    evidence: `${testCase.label} returned JSON with the expected top-level shape.`,
    httpStatus: response.status,
  };
}