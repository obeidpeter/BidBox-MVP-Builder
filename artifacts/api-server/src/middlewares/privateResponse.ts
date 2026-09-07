import type { NextFunction, Request, Response } from "express";

/**
 * Marks a response as private, uncacheable tenant data.
 *
 * `setPrivateResponseHeaders` sets only the Cache-Control header so handlers
 * that do not emit a tenant Vary header today keep their exact response shape.
 * The `privateResponse` middleware additionally varies on the organisation
 * context header, matching the suite routers that mount it per prefix.
 */
export function setPrivateResponseHeaders(response: Response): void {
  response.setHeader("Cache-Control", "private, no-store");
}

export function privateResponse(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  setPrivateResponseHeaders(response);
  response.vary("X-BidBox-Organisation-Id");
  next();
}
