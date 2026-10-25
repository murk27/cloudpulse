/**
 * The ONE Vercel Function of this project.
 *
 * Vercel turns every file in /api into a serverless function. vercel.json rewrites all /api/*
 * paths to this file, and Vercel calls fetch() with a standard Web Request. The actual routing
 * lives in backend/app.ts so it can also run locally (scripts/local-server.ts) and in tests.
 */
import { handle } from "../backend/app.js";

export default { fetch: handle };
