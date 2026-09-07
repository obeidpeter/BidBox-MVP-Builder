import { eq } from "drizzle-orm";
import { db, appConfig } from "@workspace/db";
import { DEFAULT_RISK_CONFIG, type RiskConfig } from "./deterministic";

/** The single row id for the global configuration singleton. */
export const APP_CONFIG_ID = "singleton";

/**
 * The active configuration in the shape the rest of the server consumes:
 * the risk-engine parameters, the report-template details, and the retention
 * default. Column defaults on `app_config` mirror the values that used to be
 * hard-coded, so an unconfigured install behaves exactly as before.
 */
export interface ActiveConfig {
  risk: RiskConfig;
  template: { firmName: string; confidentialityLegend: string };
  retentionDefaultDays: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export const DEFAULT_APP_CONFIG = {
  severityWeights: DEFAULT_RISK_CONFIG.severityWeights,
  missingEvidenceWeight: DEFAULT_RISK_CONFIG.missingEvidenceWeight,
  bandCutoffs: DEFAULT_RISK_CONFIG.bandCutoffs,
  firmName: "BidBox",
  confidentialityLegend:
    "CONFIDENTIAL — Prepared for internal review. Not for external distribution.",
  retentionDefaultDays: 14,
} as const;

type AppConfigRow = typeof appConfig.$inferSelect;

function toActiveConfig(row: AppConfigRow): ActiveConfig {
  return {
    risk: {
      severityWeights: {
        fatal: row.severityWeightFatal,
        likely_fatal: row.severityWeightLikelyFatal,
        scoring_risk: row.severityWeightScoringRisk,
        cosmetic: row.severityWeightCosmetic,
      },
      missingEvidenceWeight: row.missingEvidenceWeight,
      bandCutoffs: {
        medium: row.bandMediumCutoff,
        high: row.bandHighCutoff,
        critical: row.bandCriticalCutoff,
      },
    },
    template: {
      firmName: row.firmName,
      confidentialityLegend: row.confidentialityLegend,
    },
    retentionDefaultDays: row.retentionDefaultDays,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null,
  };
}

/**
 * Read the active configuration row, creating it from schema defaults on first
 * access so callers always get a concrete config. The insert is idempotent
 * (fixed primary key + onConflictDoNothing), so concurrent first reads are safe.
 * The firm name is supplied explicitly because the journalled column default
 * still carries the pre-rename brand; existing rows are changed via PATCH /config.
 */
export async function getActiveConfigRow(): Promise<AppConfigRow> {
  const [existing] = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.id, APP_CONFIG_ID));
  if (existing) return existing;
  await db
    .insert(appConfig)
    .values({ id: APP_CONFIG_ID, firmName: DEFAULT_APP_CONFIG.firmName })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.id, APP_CONFIG_ID));
  return row;
}

/** The active configuration in server-consumable shape. */
export async function getActiveConfig(): Promise<ActiveConfig> {
  return toActiveConfig(await getActiveConfigRow());
}

export { toActiveConfig };
