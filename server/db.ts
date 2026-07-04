import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@shared/schema";

// Prefer the user-provided Neon database when present, otherwise fall back to
// Replit's built-in database (DATABASE_URL is reserved/runtime-managed by Replit).
const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No database connection string is set (NEON_DATABASE_URL or DATABASE_URL)");
}

// Use HTTP-only mode - Replit blocks WebSocket connections
const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
