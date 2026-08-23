/**
 * Self-hosted Stacks DCA worker.
 *
 * POSTs /api/stacks/dca/execute, then sleeps until `nextWakeAt` from the
 * response (~45s while a swap/payout is in flight, else until the next
 * scheduled slice, capped at 5 minutes).
 *
 *   npm run dca:cron      # loop
 *   npm run dca:execute   # one shot
 *
 * Env: STACKS_DCA_CRON_SECRET (required), DCA_CRON_URL (optional).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const ONCE =
  process.env.DCA_CRON_ONCE === "1" || process.argv.includes("--once");
const SECRET = (process.env.STACKS_DCA_CRON_SECRET ?? "").trim();
const URL =
  (process.env.DCA_CRON_URL ?? "").trim() ||
  "http://127.0.0.1:3000/api/stacks/dca/execute";
const ERROR_SLEEP_MS = 45_000;
const FETCH_TIMEOUT_MS = 120_000;

if (SECRET.length < 16) {
  console.error(
    "Set STACKS_DCA_CRON_SECRET to a string of at least 16 characters.",
  );
  process.exit(1);
}

let running = false;
let stopping = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let sleepTimer = null;
/** @type {(() => void) | null} */
let sleepResolve = null;

function sleep(ms) {
  return new Promise((resolve) => {
    sleepResolve = resolve;
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      sleepResolve = null;
      resolve();
    }, ms);
  });
}

function interruptSleep() {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (sleepResolve) {
    const resolve = sleepResolve;
    sleepResolve = null;
    resolve();
  }
}

function sleepMsUntil(iso, fallbackMs) {
  if (typeof iso === "string") {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) {
      return Math.max(1_000, t - Date.now());
    }
  }
  return fallbackMs;
}

async function tick() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        accept: "application/json",
      },
      signal: ac.signal,
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text.slice(0, 300) };
    }

    const log = {
      ok: res.ok && body.ok !== false,
      status: res.status,
      processed: body.processed,
      started: body.started,
      advanced: body.advanced,
      failed: body.failed,
      inflight: body.inflight,
      busy: body.busy,
      nextExecutionAt: body.nextExecutionAt ?? null,
      nextWakeAt: body.nextWakeAt ?? null,
      error: body.error,
    };
    console.log(JSON.stringify({ t: new Date().toISOString(), ...log }));

    if (!res.ok) {
      return ERROR_SLEEP_MS;
    }
    return sleepMsUntil(body.nextWakeAt, ERROR_SLEEP_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({ t: new Date().toISOString(), ok: false, error: msg }),
    );
    return ERROR_SLEEP_MS;
  } finally {
    clearTimeout(timer);
  }
}

async function loop() {
  while (!stopping) {
    if (running) {
      await sleep(ERROR_SLEEP_MS);
      continue;
    }
    running = true;
    let wait = ERROR_SLEEP_MS;
    try {
      wait = await tick();
    } finally {
      running = false;
    }
    if (ONCE || stopping) break;
    await sleep(wait);
  }
}

function requestStop() {
  stopping = true;
  interruptSleep();
}
process.on("SIGTERM", requestStop);
process.on("SIGINT", requestStop);

await loop();
