import passport from "passport";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import pg from "pg";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      googleId?: string | null;
      email?: string | null;
      displayName?: string | null;
    }
  }
}

export function setupAuth(app: Express) {
  // Trust proxy for production (behind Replit's proxy)
  app.set('trust proxy', 1);

  // Database-backed session store
  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  pool.on('error', (err) => {
    console.error('Session pool error:', err);
  });

  pool.on('connect', () => {
    console.log('Session pool connected to database');
  });

  // Session setup with database storage
  const pgStore = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    errorLog: console.error.bind(console, 'Session store error:'),
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }

  app.use(
    session({
      store: pgStore,
      secret: process.env.SESSION_SECRET || "text-intelligence-studio-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction || !!process.env.REPLIT_DEV_DOMAIN,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  console.log(`Session configured. Secure cookies: ${isProduction || !!process.env.REPLIT_DEV_DOMAIN}`);

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUserById(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // No login system: Google OAuth removed at the owner's request.

  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          displayName: req.user.displayName,
        },
      });
    } else {
      res.json({ authenticated: false, user: null });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json({
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        displayName: req.user.displayName,
      });
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    });
  });

  // --- Admin: visitor analytics (restricted to the site owner) ---
  app.get("/api/admin/visits", isAdmin, async (_req, res) => {
    try {
      const now = Date.now();
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

      const [visitList, allTimestamps] = await Promise.all([
        storage.getVisits(500),
        storage.getVisitTimestampsSince(null),
      ]);

      const times = allTimestamps.map((t) => new Date(t).getTime());
      const stats = {
        allTime: times.length,
        last24Hours: times.filter((t) => t >= dayAgo.getTime()).length,
        lastMonth: times.filter((t) => t >= monthAgo.getTime()).length,
        lastYear: times.filter((t) => t >= yearAgo.getTime()).length,
      };

      // Build bucketed series for graphs
      const buildSeries = (start: number, bucketMs: number, buckets: number, labelFn: (d: Date) => string) => {
        const counts = new Array(buckets).fill(0);
        for (const t of times) {
          if (t >= start) {
            const idx = Math.min(Math.floor((t - start) / bucketMs), buckets - 1);
            counts[idx]++;
          }
        }
        return counts.map((count, i) => ({
          label: labelFn(new Date(start + i * bucketMs)),
          count,
        }));
      };

      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;
      const series = {
        last24Hours: buildSeries(now - 24 * HOUR, HOUR, 24, (d) =>
          d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true })),
        lastMonth: buildSeries(now - 30 * DAY, DAY, 30, (d) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" })),
        lastYear: buildSeries(now - 365 * DAY, 365 / 12 * DAY, 12, (d) =>
          d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })),
        allTime: (() => {
          const earliest = times.length ? Math.min(...times) : now;
          const span = Math.max(now - earliest, DAY);
          const buckets = Math.min(24, Math.max(6, Math.ceil(span / (30 * DAY))));
          return buildSeries(earliest, span / buckets, buckets, (d) =>
            d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }));
        })(),
      };

      res.json({
        stats,
        series,
        visits: visitList.map((v) => ({
          id: v.id,
          email: v.email,
          visitedAt: v.visitedAt,
        })),
      });
    } catch (error) {
      console.error("Admin visits error:", error);
      res.status(500).json({ error: "Failed to load visitor data" });
    }
  });
}

const ADMIN_EMAIL = "johnmichaelkuczynski@gmail.com";

export const isAdmin: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && req.user?.email?.toLowerCase() === ADMIN_EMAIL) {
    return next();
  }
  res.status(403).json({ error: "Not authorized" });
};

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
};
