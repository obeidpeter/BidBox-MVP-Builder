import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  parseExpectedVersion,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import {
  BOQ_VERIFICATION_READ_PERMISSION,
  BOQ_VERIFICATION_RESOLVE_PERMISSION,
  BOQ_VERIFICATION_RUN_PERMISSION,
  BoqVerificationProjectAccessError,
  BoqVerificationRepositoryUnavailableError,
  type BoqVerificationRepository,
  type BoqVerificationScope,
} from "../lib/boqVerification/contracts";
import { postgresBoqVerificationRepository } from "../lib/boqVerification/repository";
import {
  BOQ_VERIFICATION_AUTHORITY_NOTE,
  parseBoqExceptionResolutionDraft,
  parseBoqRunDraft,
  resolutionHttpStatus,
  runHttpStatus,
} from "../lib/boqVerification/service";

export interface BoqVerificationRouterOptions {
  repository?: BoqVerificationRepository;
  now?: () => Date;
}

function privateResponse(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.vary("X-BidBox-Organisation-Id");
  next();
}

function scopeFor(request: Request): BoqVerificationScope | null {
  const organisationId = getOrganisationId(request);
  const projectId = request.params.projectId;
  if (!organisationId || typeof projectId !== "string") return null;
  return {
    organisationId,
    projectId,
    actorUserId: getLocalUser(request)?.id ?? null,
  };
}

function handleError(
  error: unknown,
  response: Response,
  next: NextFunction,
): void {
  if (error instanceof BoqVerificationProjectAccessError) {
    response.status(error.code === "not_found" ? 404 : 409).json({
      error: error.code,
      authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
    });
    return;
  }
  if (error instanceof BoqVerificationRepositoryUnavailableError) {
    response.status(503).json({
      error: "BOQ verification is unavailable",
      authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
    });
    return;
  }
  next(error);
}

/**
 * Mount under `/api` after authentication and tenant/project governance. The
 * verifier is deterministic: the server pins the rule pack, binds every run
 * to the current cleared version of a governed project document, and records
 * exceptions for named-human resolution.
 */
export function createBoqVerificationRouter(
  options: BoqVerificationRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const repository = options.repository ?? postgresBoqVerificationRepository;
  const now = options.now ?? (() => new Date());

  router.use("/projects/:projectId/boq-verification", privateResponse);

  router.get(
    "/projects/:projectId/boq-verification",
    requirePermissionOrLegacy(BOQ_VERIFICATION_READ_PERMISSION),
    async (request, response, next) => {
      const scope = scopeFor(request);
      if (!scope) {
        response.status(403).json({ error: "BOQ verification access denied" });
        return;
      }
      try {
        response.json(await repository.readSnapshot(scope, now()));
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/boq-verification/runs",
    requirePermissionOrLegacy(BOQ_VERIFICATION_RUN_PERMISSION),
    async (request, response, next) => {
      const scope = scopeFor(request);
      if (!scope) {
        response.status(403).json({ error: "BOQ verification access denied" });
        return;
      }
      const draft = parseBoqRunDraft(request.body);
      if (!draft) {
        response.status(400).json({
          error: "Invalid bounded BOQ verification request",
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        });
        return;
      }
      try {
        const outcome = await repository.createRun(scope, draft, now());
        if (outcome.outcome === "created") {
          response.status(runHttpStatus(outcome)).json({
            ...outcome,
            authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
          });
          return;
        }
        response.status(runHttpStatus(outcome)).json({
          error: outcome.outcome,
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        });
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.get(
    "/projects/:projectId/boq-verification/runs/:runId",
    requirePermissionOrLegacy(BOQ_VERIFICATION_READ_PERMISSION),
    async (request, response, next) => {
      const scope = scopeFor(request);
      const runId = request.params.runId;
      if (!scope || typeof runId !== "string") {
        response.status(403).json({ error: "BOQ verification access denied" });
        return;
      }
      try {
        const detail = await repository.readRun(scope, runId);
        if (!detail) {
          response.status(404).json({ error: "not_found" });
          return;
        }
        response.json(detail);
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.post(
    "/projects/:projectId/boq-verification/exceptions/:exceptionId/resolution",
    requirePermissionOrLegacy(BOQ_VERIFICATION_RESOLVE_PERMISSION),
    async (request, response, next) => {
      const scope = scopeFor(request);
      const exceptionId = request.params.exceptionId;
      if (!scope || typeof exceptionId !== "string") {
        response.status(403).json({ error: "BOQ verification access denied" });
        return;
      }
      const expectedVersion = parseExpectedVersion(request.get("If-Match"));
      if (!expectedVersion) {
        response.status(428).json({ error: "If-Match version is required" });
        return;
      }
      const draft = parseBoqExceptionResolutionDraft(request.body);
      if (!draft) {
        response.status(400).json({
          error: "Invalid bounded exception resolution",
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        });
        return;
      }
      try {
        const outcome = await repository.resolveException(
          scope,
          exceptionId,
          expectedVersion,
          draft,
          now(),
        );
        if (outcome.outcome === "updated") {
          response.setHeader("ETag", `"${outcome.exception.version}"`);
          response.status(resolutionHttpStatus(outcome)).json({
            ...outcome,
            authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
          });
          return;
        }
        response.status(resolutionHttpStatus(outcome)).json({
          error: outcome.outcome,
          authorityNote: BOQ_VERIFICATION_AUTHORITY_NOTE,
        });
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  return router;
}

export const boqVerificationRouter = createBoqVerificationRouter();
