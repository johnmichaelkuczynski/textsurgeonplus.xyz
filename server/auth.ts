import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createClerkClient, verifyToken } from "@clerk/express";
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
  // Strip invisible characters (non-breaking spaces, zero-width chars, BOM) and
  // surrounding whitespace that often sneak in when secrets are copy-pasted.
  const sanitizeSecret = (v?: string) =>
    (v || "").replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "").trim();

  const clientID = sanitizeSecret(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = sanitizeSecret(process.env.GOOGLE_CLIENT_SECRET);
  const clerkSecretKey = sanitizeSecret(process.env.CLERK_SECRET_KEY);

  const googleEnabled = !!(clientID && clientSecret);
  const clerkEnabled = !!clerkSecretKey;

  if (!googleEnabled) {
    console.warn("Google OAuth credentials not found. Google login disabled.");
  }

  // Trust proxy for production (behind Render/nginx)
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

  // --- Google OAuth (legacy, kept while credentials exist) ---
  if (googleEnabled) {
    const getCallbackURL = () => {
      if (process.env.NODE_ENV === "production") {
        return "https://textsurgeon.com/auth/google/callback";
      }
      if (process.env.REPLIT_DEV_DOMAIN) {
        return `https://${process.env.REPLIT_DEV_DOMAIN}/auth/google/callback`;
      }
      if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
        return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/auth/google/callback`;
      }
      return "http://localhost:5000/auth/google/callback";
    };

    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL: getCallbackURL(),
          passReqToCallback: false,
        } as any,
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || null;
            const displayName = profile.displayName || null;
            const googleId = profile.id;

            console.log(`Google OAuth: Processing login for ${email || googleId}`);

            let user = await storage.getUserByGoogleId(googleId);

            if (!user) {
              if (email) {
                user = await storage.getUserByEmail(email);
              }

              if (!user) {
                const username = email?.split("@")[0] || `user_${googleId.substring(0, 8)}`;
                user = await storage.createUserWithGoogle({
                  username,
                  googleId,
                  email,
                  displayName,
                });
                console.log(`Google OAuth: Created new user ${user.id} (${user.username})`);
              } else {
                user = await storage.updateUserGoogle(user.id, {
                  googleId,
                  displayName,
                });
                console.log(`Google OAuth: Updated existing user ${user.id} with Google info`);
              }
            } else {
              user = await storage.updateUserGoogle(user.id, {
                displayName,
              });
              console.log(`Google OAuth: Updated profile for user ${user.id}`);
            }

            console.log(`Google OAuth: Login successful for user ${user.id}`);
            done(null, user);
          } catch (error) {
            console.error("Google auth error:", error);
            done(error as Error);
          }
        }
      )
    );

    app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

    app.get(
      "/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/?error=auth_failed" }),
      (req, res) => {
        req.session.save(() => {
          res.redirect("/");
        });
      }
    );

    console.log("Google OAuth configured. Callback URL:", getCallbackURL());
  }

  // --- Clerk authentication ---
  if (clerkEnabled) {
    const clerkClient = createClerkClient({ secretKey: clerkSecretKey });

    app.post("/api/auth/clerk-sync", async (req, res) => {
      try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!token) {
          return res.status(401).json({ error: "Missing Clerk session token" });
        }

        const payload = await verifyToken(token, { secretKey: clerkSecretKey });
        if (!payload?.sub) {
          return res.status(401).json({ error: "Invalid Clerk session token" });
        }

        const clerkUser = await clerkClient.users.getUser(payload.sub);
        const email =
          clerkUser.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ||
          clerkUser.emailAddresses?.[0]?.emailAddress ||
          null;
        const displayName =
          [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
          clerkUser.username ||
          email ||
          null;
        const clerkId = `clerk:${clerkUser.id}`;

        // Find or create a local user (reuses the googleId column for the Clerk ID)
        let user = await storage.getUserByGoogleId(clerkId);
        if (!user && email) {
          user = await storage.getUserByEmail(email);
          if (user) {
            user = await storage.updateUserGoogle(user.id, { googleId: clerkId, displayName });
          }
        }
        if (!user) {
          const username = email?.split("@")[0] || clerkUser.username || `user_${clerkUser.id.slice(-8)}`;
          user = await storage.createUserWithGoogle({
            username,
            googleId: clerkId,
            email,
            displayName,
          });
          console.log(`Clerk: Created new user ${user.id} (${user.username})`);
        }

        req.login(user, (err) => {
          if (err) {
            console.error("Clerk session login error:", err);
            return res.status(500).json({ error: "Failed to establish session" });
          }
          // Record a visit (throttled: at most one per 30 minutes per user)
          (async () => {
            try {
              const last = await storage.getLastVisit(user!.id);
              const THROTTLE_MS = 30 * 60 * 1000;
              if (!last || Date.now() - new Date(last.visitedAt).getTime() > THROTTLE_MS) {
                await storage.recordVisit(user!.id, user!.email);
              }
            } catch (visitErr) {
              console.error("Failed to record visit:", visitErr);
            }
          })();
          req.session.save(() => {
            res.json({
              authenticated: true,
              user: {
                id: user!.id,
                username: user!.username,
                email: user!.email,
                displayName: user!.displayName,
              },
            });
          });
        });
      } catch (error) {
        console.error("Clerk sync error:", error);
        res.status(401).json({ error: "Clerk authentication failed" });
      }
    });

    console.log("Clerk authentication configured.");
  } else {
    console.warn("CLERK_SECRET_KEY not found. Clerk login disabled.");
  }

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

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
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
