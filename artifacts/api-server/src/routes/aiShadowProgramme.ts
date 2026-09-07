import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getLocalUser } from "../middlewares/auth";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import type { OrganisationRole } from "../lib/permissions";
import {
  AI_SHADOW_PROGRAMME_STATUS,
  AiShadowProgrammeError,
  AiShadowProgrammeService,
  AuditAiShadowRepository,
  parseAiShadowCloseDraft,
  parseAiShadowObservationDraft,
  parseAiShadowPlanDraft,
  type AiShadowRepository,
  type AiShadowScope,
} from "../lib/aiShadowProgramme";

const READ_ROLES = new Set<OrganisationRole>([
  "valo_operations_administrator",
  "valo_quality_adviser",
  "restricted_platform_administrator",
]);
const MANAGE_ROLES = new Set<OrganisationRole>([
  "valo_operations_administrator",
  "valo_quality_adviser",
]);

export interface AiShadowProgrammeRouterOptions {
  repository?: AiShadowRepository;
  now?: () => Date;
  resolveAccess?: (request: Request) => AccessContext | undefined;
  resolveActor?: (
    request: Request,
  ) => { id: string; name: string | null } | null;
}

export function canReadAiShadowProgramme(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    context?.source === "membership" &&
    context.permissions.has("evaluation:read") &&
    context.roles.some((role) => READ_ROLES.has(role)),
  );
}

export function canManageAiShadowProgramme(
  context: AccessContext | undefined,
): boolean {
  return Boolean(
    canReadAiShadowProgramme(context) &&
    context?.permissions.has("evaluation:manage") &&
    context.roles.some((role) => MANAGE_ROLES.has(role)),
  );
}

function privateHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.vary("X-BidBox-Organisation-Id");
  next();
}

function sendError(response: Response, error: unknown): boolean {
  if (!(error instanceof AiShadowProgrammeError)) return false;
  const status =
    error.code === "invalid_request"
      ? 400
      : error.code === "not_found"
        ? 404
        : error.code === "conflict"
          ? 409
          : error.code === "policy_denied"
            ? 422
            : error.code === "capacity_exceeded"
              ? 413
              : 503;
  response.status(status).json({
    error: error.message,
    code: error.code,
    productionActivationGranted: false,
  });
  return true;
}

export function createAiShadowProgrammeRouter(
  options: AiShadowProgrammeRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActor =
    options.resolveActor ??
    ((request: Request) => {
      const user = getLocalUser(request);
      return user ? { id: user.id, name: user.name } : null;
    });
  const service = new AiShadowProgrammeService(
    options.repository ?? new AuditAiShadowRepository(),
    options.now,
  );

  const scope = (request: Request): AiShadowScope | null => {
    const context = resolveAccess(request);
    const actor = resolveActor(request);
    const name = actor?.name;
    return context && actor && name && name === name.trim()
      ? {
          organisationId: context.organisationId,
          actorUserId: actor.id,
          actorName: name,
        }
      : null;
  };

  router.use("/ai/shadow-programme", privateHeaders);

  router.get("/ai/shadow-programme", async (request, response, next) => {
    const context = resolveAccess(request);
    const requestScope = scope(request);
    if (!canReadAiShadowProgramme(context) || !requestScope) {
      response.status(403).json({ error: "AI shadow programme access denied" });
      return;
    }
    try {
      response.json(await service.snapshot(requestScope));
    } catch (error) {
      if (!sendError(response, error)) next(error);
    }
  });

  router.post("/ai/shadow-programme/plans", async (request, response, next) => {
    const context = resolveAccess(request);
    const requestScope = scope(request);
    if (!canManageAiShadowProgramme(context) || !requestScope) {
      response.status(403).json({ error: "AI shadow plan creation denied" });
      return;
    }
    const draft = parseAiShadowPlanDraft(request.body);
    if (!draft) {
      response.status(400).json({ error: "Invalid AI shadow plan" });
      return;
    }
    try {
      const result = await service.createPlan(requestScope, draft);
      if (result.outcome === "idempotency_conflict") {
        response.status(409).json({ error: "Idempotency key conflict" });
        return;
      }
      response.status(result.outcome === "created" ? 201 : 200).json({
        plan: result.value,
        replayed: result.outcome === "replayed",
        authority: AI_SHADOW_PROGRAMME_STATUS,
      });
    } catch (error) {
      if (!sendError(response, error)) next(error);
    }
  });

  router.post(
    "/ai/shadow-programme/plans/:planId/observations",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const requestScope = scope(request);
      if (!canManageAiShadowProgramme(context) || !requestScope) {
        response
          .status(403)
          .json({ error: "AI shadow observation recording denied" });
        return;
      }
      const draft = parseAiShadowObservationDraft(request.body);
      if (!draft) {
        response.status(400).json({ error: "Invalid AI shadow observation" });
        return;
      }
      try {
        const result = await service.recordObservation(
          requestScope,
          String(request.params.planId),
          draft,
        );
        if (result.outcome === "idempotency_conflict") {
          response.status(409).json({ error: "Idempotency key conflict" });
          return;
        }
        response.status(result.outcome === "recorded" ? 201 : 200).json({
          observation: result.value,
          replayed: result.outcome === "replayed",
          rawOutputPersisted: false,
          productionActivationGranted: false,
        });
      } catch (error) {
        if (!sendError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/ai/shadow-programme/plans/:planId/close",
    async (request, response, next) => {
      const context = resolveAccess(request);
      const requestScope = scope(request);
      if (!canManageAiShadowProgramme(context) || !requestScope) {
        response.status(403).json({ error: "AI shadow plan closure denied" });
        return;
      }
      const close = parseAiShadowCloseDraft(request.body);
      if (!close) {
        response.status(400).json({ error: "Invalid AI shadow closure" });
        return;
      }
      try {
        const result = await service.closePlan(
          requestScope,
          String(request.params.planId),
          close,
        );
        if (result.outcome === "idempotency_conflict") {
          response.status(409).json({ error: "Closure conflict" });
          return;
        }
        response.json({
          plan: result.value,
          productionActivationGranted: false,
          authority: AI_SHADOW_PROGRAMME_STATUS,
        });
      } catch (error) {
        if (!sendError(response, error)) next(error);
      }
    },
  );

  return router;
}

export default createAiShadowProgrammeRouter();
