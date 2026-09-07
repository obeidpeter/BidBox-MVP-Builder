import { pathToFileURL } from "node:url";
import { runReplitIntakeMigrations } from "@workspace/db/replit-intake-migrations";
import { maybeStartInProcessSchedules } from "./run-inprocess-schedules.mjs";

const API_SERVER_ENTRYPOINT = new URL(
  "../artifacts/api-server/dist/index.mjs",
  import.meta.url,
);
const SAFE_MIGRATION_FAILURE_PREFIX = "Replit intake migration gate failed:";
const SAFE_STARTUP_FAILURE =
  "Replit production startup failed: migration gate or server bootstrap operation failed";

export function formatReplitProductionStartupError(error) {
  if (
    error instanceof Error &&
    error.message.startsWith(SAFE_MIGRATION_FAILURE_PREFIX)
  ) {
    return error.message;
  }

  return SAFE_STARTUP_FAILURE;
}

export async function startReplitProduction({
  environment = process.env,
  runMigrations = runReplitIntakeMigrations,
  startSchedules = maybeStartInProcessSchedules,
  importApiServer = () => import(API_SERVER_ENTRYPOINT.href),
} = {}) {
  await runMigrations(environment);
  // An explicitly opted-in, misconfigured schedule selection refuses startup
  // before the API serves traffic; with no opt-in this is a no-op.
  await startSchedules({ environment });
  await importApiServer();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startReplitProduction().catch((error) => {
    process.stderr.write(`${formatReplitProductionStartupError(error)}\n`);
    process.exitCode = 1;
  });
}
