import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  GROWTH_SUITE_BOUNDS,
  GrowthSuiteRepositoryUnavailableError,
  unavailableGrowthSuiteRepository,
  type GrowthSuiteRepository,
  type GrowthSuiteScope,
  type LeadContactHandoffPurpose,
  type LeadInboxItem,
  type LeadInboxMutation,
  type QuoteProposal,
} from "../lib/growthSuite/contracts";
import {
  OFFER_CATALOGUE,
  OFFER_CATALOGUE_VERSION,
  parseQuoteDraft,
} from "../lib/growthSuite/offerCatalogue";
import { deriveOnboardingJourney } from "../lib/growthSuite/onboarding";
import {
  OnboardingProgressUnavailableError,
  unavailableOnboardingProgressRepository,
  type OnboardingProgressMutation,
  type OnboardingProgressRepository,
} from "../lib/growthSuite/onboardingProgress";
import {
  canManageCommercialOffers,
  canOperateGrowthLeads,
  canViewGrowthOnboarding,
} from "../lib/growthSuite/policy";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
import { SHA256_HEX_PATTERN as SHA256 } from "../lib/identifierPatterns";
const CONTACT_HANDOFF_PURPOSES = new Set<LeadContactHandoffPurpose>([
  "initial_follow_up",
  "qualification_call",
  "conversion_handoff",
]);
const HUMAN_CONTROL_NOTE =
  "Every assignment, qualification, conversion proposal, quote term and quote approval is a named human action. This surface sends no email, creates no CRM record, converts no pursuit, submits no bid, calculates no price and collects no payment.";

export interface GrowthSuiteRouterOptions {
  repository?: GrowthSuiteRepository;
  onboardingProgressRepository?: OnboardingProgressRepository;
  now?: () => Date;
  resolveAccess?: (req: Request) => AccessContext | undefined;
  resolveActorUserId?: (req: Request) => string | undefined;
}

import { isPlainRecord } from "../lib/typeGuards";

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    Buffer.byteLength(normalized, "utf8") > GROWTH_SUITE_BOUNDS.maxSummaryBytes
  ) {
    return null;
  }
  return normalized;
}

function boundedId(value: unknown): string | null {
  const id = boundedText(value, GROWTH_SUITE_BOUNDS.maxIdCodeUnits);
  return id && SAFE_ID.test(id) ? id : null;
}

function expectedVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
}

function onboardingExpectedVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

export function parseOnboardingProgressMutation(
  value: unknown,
): OnboardingProgressMutation | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const canonical = hasExactKeys(value, [
    "journeyVersion",
    "itemId",
    "expectedVersion",
    "markerSaved",
  ]);
  const legacy = hasExactKeys(value, [
    "journeyVersion",
    "itemId",
    "expectedVersion",
    "completed",
  ]);
  const markerSaved = canonical ? value.markerSaved : value.completed;
  if (
    (!canonical && !legacy) ||
    value.journeyVersion !== "2026-08-11.2" ||
    typeof markerSaved !== "boolean"
  )
    return null;
  const itemId = boundedId(value.itemId);
  const version = onboardingExpectedVersion(value.expectedVersion);
  return itemId && version !== null
    ? {
        journeyVersion: value.journeyVersion,
        itemId,
        expectedVersion: version,
        markerSaved,
      }
    : null;
}

function futureIsoInstant(
  value: unknown,
  now: Date,
  maximumDays: number,
): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() <= now.getTime() ||
    parsed.getTime() > now.getTime() + maximumDays * 86_400_000
  ) {
    return null;
  }
  return value;
}

export function parseLeadInboxMutation(
  value: unknown,
  now = new Date(),
): LeadInboxMutation | null {
  if (!isPlainRecord(value) || typeof value.action !== "string") return null;
  const version = expectedVersion(value.expectedVersion);
  if (!version) return null;
  switch (value.action) {
    case "assign": {
      if (!hasExactKeys(value, ["action", "expectedVersion", "assigneeUserId"]))
        return null;
      const assigneeUserId = boundedId(value.assigneeUserId);
      return assigneeUserId
        ? { action: "assign", expectedVersion: version, assigneeUserId }
        : null;
    }
    case "set_status":
      if (typeof value.status !== "string") {
        return null;
      }
      if (value.status === "qualified" || value.status === "not_a_fit") {
        if (
          !hasExactKeys(value, [
            "action",
            "expectedVersion",
            "status",
            "reason",
          ])
        ) {
          return null;
        }
        const reason = boundedText(
          value.reason,
          GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
        );
        return reason
          ? {
              action: "set_status",
              expectedVersion: version,
              status: value.status,
              reason,
            }
          : null;
      }
      if (value.status === "converted") {
        if (
          !hasExactKeys(value, [
            "action",
            "expectedVersion",
            "status",
            "reason",
            "externalTargetReference",
            "receiptSha256",
          ])
        ) {
          return null;
        }
        const reason = boundedText(
          value.reason,
          GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
        );
        const externalTargetReference = boundedText(
          value.externalTargetReference,
          GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
        );
        return reason &&
          externalTargetReference &&
          typeof value.receiptSha256 === "string" &&
          SHA256.test(value.receiptSha256)
          ? {
              action: "set_status",
              expectedVersion: version,
              status: "converted",
              reason,
              externalTargetReference,
              receiptSha256: value.receiptSha256,
            }
          : null;
      }
      return null;
    case "set_sla": {
      if (!hasExactKeys(value, ["action", "expectedVersion", "slaDueAt"]))
        return null;
      const slaDueAt = futureIsoInstant(
        value.slaDueAt,
        now,
        GROWTH_SUITE_BOUNDS.maxSlaDays,
      );
      return slaDueAt
        ? { action: "set_sla", expectedVersion: version, slaDueAt }
        : null;
    }
    case "propose_conversion": {
      if (
        !hasExactKeys(value, [
          "action",
          "expectedVersion",
          "suggestedPursuitTitle",
          "rationale",
        ])
      ) {
        return null;
      }
      const suggestedPursuitTitle = boundedText(
        value.suggestedPursuitTitle,
        GROWTH_SUITE_BOUNDS.maxLabelCodeUnits,
      );
      const rationale = boundedText(
        value.rationale,
        GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
      );
      return suggestedPursuitTitle && rationale
        ? {
            action: "propose_conversion",
            expectedVersion: version,
            suggestedPursuitTitle,
            rationale,
          }
        : null;
    }
    default:
      return null;
  }
}

export function parseLeadContactHandoffRequest(
  value: unknown,
): { expectedVersion: number; purpose: LeadContactHandoffPurpose } | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["expectedVersion", "purpose"]) ||
    typeof value.purpose !== "string" ||
    !CONTACT_HANDOFF_PURPOSES.has(value.purpose as LeadContactHandoffPurpose)
  ) {
    return null;
  }
  const version = expectedVersion(value.expectedVersion);
  return version
    ? {
        expectedVersion: version,
        purpose: value.purpose as LeadContactHandoffPurpose,
      }
    : null;
}

function parseLimit(req: Request): number | null {
  if (Object.keys(req.query).some((key) => key !== "limit")) return null;
  if (req.query.limit === undefined) return 25;
  if (
    typeof req.query.limit !== "string" ||
    !/^\d{1,2}$/u.test(req.query.limit)
  )
    return null;
  const limit = Number(req.query.limit);
  return Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= GROWTH_SUITE_BOUNDS.maxListRows
    ? limit
    : null;
}

function assertScopedRows<T extends { organisationId: string }>(
  rows: readonly T[],
  organisationId: string,
  limit: number,
): void {
  if (
    rows.length > limit ||
    rows.some(
      ({ organisationId: rowOrganisationId }) =>
        rowOrganisationId !== organisationId,
    )
  ) {
    throw new GrowthSuiteRepositoryUnavailableError();
  }
}

function setPrivateResponseHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("X-BidBox-Organisation-Id");
}

function sendRepositoryError(res: Response, error: unknown): boolean {
  if (!(error instanceof GrowthSuiteRepositoryUnavailableError)) return false;
  res.status(503).json({ error: "Growth operations are not available" });
  return true;
}

export function createGrowthSuiteRouter(
  options: GrowthSuiteRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository = options.repository ?? unavailableGrowthSuiteRepository;
  const onboardingProgressRepository =
    options.onboardingProgressRepository ??
    unavailableOnboardingProgressRepository;
  const now = options.now ?? (() => new Date());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActorUserId =
    options.resolveActorUserId ?? ((req: Request) => getLocalUser(req)?.id);

  const scope = (req: Request): GrowthSuiteScope | null => {
    const context = resolveAccess(req);
    const actorUserId = resolveActorUserId(req);
    return context && actorUserId
      ? { organisationId: context.organisationId, actorUserId }
      : null;
  };

  router.use((_req, res, next) => {
    setPrivateResponseHeaders(res);
    next();
  });

  router.get("/growth-suite/onboarding", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canViewGrowthOnboarding(context) || !requestScope) {
      res.status(403).json({ error: "Growth onboarding access denied" });
      return;
    }
    const journey = deriveOnboardingJourney(context!.roles);
    try {
      const progress = await onboardingProgressRepository.getProgress(
        requestScope,
        context!.roles,
      );
      res.json({ journey, progress, authorityNote: HUMAN_CONTROL_NOTE });
    } catch (error) {
      if (error instanceof OnboardingProgressUnavailableError) {
        res.status(503).json({ error: "Onboarding progress is not available" });
        return;
      }
      throw error;
    }
  });

  router.post("/growth-suite/onboarding/progress", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canViewGrowthOnboarding(context) || !requestScope) {
      res.status(403).json({ error: "Growth onboarding access denied" });
      return;
    }
    const mutation = parseOnboardingProgressMutation(req.body);
    if (!mutation) {
      res.status(400).json({ error: "Invalid onboarding practice marker" });
      return;
    }
    try {
      const result = await onboardingProgressRepository.mutateProgress(
        requestScope,
        context!.roles,
        mutation,
      );
      if (result.outcome === "policy_denied") {
        res.status(403).json({ error: "Onboarding practice marker denied" });
        return;
      }
      if (result.outcome !== "updated") {
        res.status(409).json({ error: "Onboarding progress changed" });
        return;
      }
      res.json({
        progress: result.progress,
        authorityNote: HUMAN_CONTROL_NOTE,
      });
    } catch (error) {
      if (error instanceof OnboardingProgressUnavailableError) {
        res.status(503).json({ error: "Onboarding progress is not available" });
        return;
      }
      throw error;
    }
  });

  router.get("/growth-suite/offers", (req, res) => {
    const context = resolveAccess(req);
    if (!canViewGrowthOnboarding(context) || !resolveActorUserId(req)) {
      res.status(403).json({ error: "Offer catalogue access denied" });
      return;
    }
    res.json({
      catalogueVersion: OFFER_CATALOGUE_VERSION,
      items: OFFER_CATALOGUE,
      authorityNote: HUMAN_CONTROL_NOTE,
    });
  });

  router.get("/growth-suite/leads", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canOperateGrowthLeads(context) || !requestScope) {
      res.status(403).json({ error: "Lead operations access denied" });
      return;
    }
    const limit = parseLimit(req);
    if (!limit) {
      res.status(400).json({ error: "Invalid list request" });
      return;
    }
    try {
      const items = await repository.listLeads(requestScope, limit);
      assertScopedRows(items, requestScope.organisationId, limit);
      res.json({
        items,
        count: items.length,
        contactDataIncluded: false,
        authorityNote: HUMAN_CONTROL_NOTE,
      });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  router.post("/growth-suite/leads/:id/actions", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canOperateGrowthLeads(context) || !requestScope) {
      res.status(403).json({ error: "Lead operations access denied" });
      return;
    }
    const leadId = boundedId(req.params.id);
    const mutation = parseLeadInboxMutation(req.body, now());
    if (!leadId || !mutation) {
      res.status(400).json({ error: "Invalid lead action" });
      return;
    }
    try {
      const result = await repository.mutateLead(
        requestScope,
        leadId,
        mutation,
      );
      if (result.outcome !== "updated") {
        res
          .status(409)
          .json({ error: "Lead changed or action is unavailable" });
        return;
      }
      assertScopedRows([result.record], requestScope.organisationId, 1);
      res.json({ item: result.record, authorityNote: HUMAN_CONTROL_NOTE });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  router.post("/growth-suite/leads/:id/contact-handoff", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canOperateGrowthLeads(context) || !requestScope) {
      res.status(403).json({ error: "Lead contact handoff access denied" });
      return;
    }
    const leadId = boundedId(req.params.id);
    const request = parseLeadContactHandoffRequest(req.body);
    if (!leadId || !request) {
      res.status(400).json({ error: "Invalid lead contact handoff" });
      return;
    }
    try {
      const result = await repository.getLeadContactHandoff(
        requestScope,
        leadId,
        request.expectedVersion,
        request.purpose,
      );
      if (result.outcome === "policy_denied") {
        res.status(403).json({
          error: "Only the currently assigned operator may open this contact",
        });
        return;
      }
      if (result.outcome !== "updated") {
        res
          .status(409)
          .json({ error: "Lead changed or contact is unavailable" });
        return;
      }
      res.json({
        handoff: result.record,
        contactDataIncluded: true,
        authorityNote:
          "This single-record contact handoff is for the recorded purpose and assigned operator only. It sends no message and must not be copied into logs or bulk exports.",
      });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  router.get("/growth-suite/quotes", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canManageCommercialOffers(context) || !requestScope) {
      res.status(403).json({ error: "Commercial offer access denied" });
      return;
    }
    const limit = parseLimit(req);
    if (!limit) {
      res.status(400).json({ error: "Invalid list request" });
      return;
    }
    try {
      const items = await repository.listQuotes(requestScope, limit);
      assertScopedRows(items, requestScope.organisationId, limit);
      res.json({
        items,
        count: items.length,
        authorityNote: HUMAN_CONTROL_NOTE,
      });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  router.post("/growth-suite/quotes", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canManageCommercialOffers(context) || !requestScope) {
      res.status(403).json({ error: "Commercial offer access denied" });
      return;
    }
    const draft = parseQuoteDraft(req.body, now());
    if (!draft) {
      res.status(400).json({ error: "Invalid human-entered quote terms" });
      return;
    }
    try {
      const quote = await repository.createQuoteDraft(requestScope, draft);
      assertScopedRows([quote], requestScope.organisationId, 1);
      res.status(201).json({ quote, authorityNote: HUMAN_CONTROL_NOTE });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  router.post("/growth-suite/quotes/:id/approve", async (req, res) => {
    const context = resolveAccess(req);
    const requestScope = scope(req);
    if (!canManageCommercialOffers(context) || !requestScope) {
      res.status(403).json({ error: "Commercial offer access denied" });
      return;
    }
    const quoteId = boundedId(req.params.id);
    if (
      !quoteId ||
      !isPlainRecord(req.body) ||
      !hasExactKeys(req.body, ["expectedVersion"]) ||
      !expectedVersion(req.body.expectedVersion)
    ) {
      res.status(400).json({ error: "Invalid quote approval" });
      return;
    }
    try {
      const result = await repository.approveQuote(
        requestScope,
        quoteId,
        req.body.expectedVersion as number,
      );
      if (result.outcome === "policy_denied") {
        res.status(409).json({
          error: "A different named operator must approve this quote",
        });
        return;
      }
      if (result.outcome !== "updated") {
        res.status(409).json({ error: "Quote changed or cannot be approved" });
        return;
      }
      assertScopedRows([result.record], requestScope.organisationId, 1);
      res.json({ quote: result.record, authorityNote: HUMAN_CONTROL_NOTE });
    } catch (error) {
      if (!sendRepositoryError(res, error)) throw error;
    }
  });

  return router;
}

const router = createGrowthSuiteRouter();
export default router;

export type GrowthSuiteLeadResponse = {
  item: LeadInboxItem;
  authorityNote: string;
};

export type GrowthSuiteQuoteResponse = {
  quote: QuoteProposal;
  authorityNote: string;
};
