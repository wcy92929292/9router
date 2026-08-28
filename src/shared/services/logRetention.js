/**
 * Log Retention Service
 *
 * Periodically cleans up two types of logs:
 * 1. File-based request logs under {project_root}/logs/ — one folder per request.
 * 2. Database request details in the `requestDetails` table — rows older than the retention period.
 *
 * Retention days come from settings.logRetentionDays (default 7).
 * Runs every 6 hours via setInterval (unref'd so it won't block process exit).
 */

import { existsSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";

const DEFAULT_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 minute after startup

let intervalHandle = null;

/**
 * Read retention days from settings (with fallback to default).
 */
async function getRetentionDays() {
  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const days = parseInt(settings.logRetentionDays, 10);
    return (Number.isFinite(days) && days > 0) ? days : DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

/**
 * Clean up file-based request logs under {cwd}/logs/.
 * Each subfolder name contains a timestamp like 20260828_115329_942.
 * Folders older than retentionDays are deleted entirely.
 */
function cleanFileLogs(retentionDays) {
  const logsDir = join(process.cwd(), "logs");
  if (!existsSync(logsDir)) return { deleted: 0, skipped: 0 };

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let skipped = 0;

  let entries;
  try {
    entries = readdirSync(logsDir);
  } catch {
    return { deleted: 0, skipped: 0 };
  }

  for (const entry of entries) {
    const fullPath = join(logsDir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    // Use folder/file mtime as the age indicator
    if (st.mtimeMs < cutoff) {
      try {
        rmSync(fullPath, { recursive: true, force: true });
        deleted++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  return { deleted, skipped };
}

/**
 * Clean up database request details older than retentionDays.
 * Uses the `timestamp` column (ISO string) for age comparison.
 */
async function cleanDatabaseLogs(retentionDays) {
  try {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const result = db.run(
      `DELETE FROM requestDetails WHERE timestamp < ?`,
      [cutoff]
    );

    // better-sqlite3 returns { changes: N } on run()
    const deleted = (result && typeof result.changes === "number") ? result.changes : 0;
    return { deleted };
  } catch (e) {
    console.error("[LogRetention] DB cleanup failed:", e.message);
    return { deleted: 0, error: e.message };
  }
}

/**
 * Run one cleanup cycle.
 */
async function runCleanup() {
  const retentionDays = await getRetentionDays();
  console.log(`[LogRetention] starting cleanup (retention=${retentionDays}d)`);

  const fileResult = cleanFileLogs(retentionDays);
  console.log(`[LogRetention] file logs: deleted=${fileResult.deleted}, kept=${fileResult.skipped}`);

  const dbResult = await cleanDatabaseLogs(retentionDays);
  console.log(`[LogRetention] db logs: deleted=${dbResult.deleted}${dbResult.error ? `, error=${dbResult.error}` : ""}`);
}

/**
 * Start the periodic cleanup scheduler.
 * Idempotent — safe to call multiple times (only one interval active).
 */
export function startLogRetention() {
  if (intervalHandle) return;

  // Delay first run so it doesn't compete with startup
  setTimeout(() => {
    runCleanup().catch((e) => console.error("[LogRetention] first run failed:", e.message));
  }, FIRST_RUN_DELAY_MS);

  intervalHandle = setInterval(() => {
    runCleanup().catch((e) => console.error("[LogRetention] scheduled run failed:", e.message));
  }, CLEANUP_INTERVAL_MS);

  if (intervalHandle.unref) intervalHandle.unref();

  console.log(`[LogRetention] scheduler started (interval=${CLEANUP_INTERVAL_MS / 1000 / 60}min)`);
}

/**
 * Stop the periodic cleanup scheduler.
 */
export function stopLogRetention() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}
