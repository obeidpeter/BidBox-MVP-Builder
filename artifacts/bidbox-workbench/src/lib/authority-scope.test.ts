import { describe, expect, it } from "vitest";
import {
  assertAuthorityScopeCurrent,
  authorityScopeIsCurrent,
} from "./authority-scope";

const requestedScope = {
  organisationId: "organisation-1",
  projectId: "project-1",
  actorUserId: "actor-1",
  capabilityKey: "project:read|project:update",
};

describe("authority scope", () => {
  it("accepts only the same own scope keys and values", () => {
    expect(authorityScopeIsCurrent({ ...requestedScope }, requestedScope)).toBe(
      true,
    );
    expect(
      authorityScopeIsCurrent(
        {
          capabilityKey: requestedScope.capabilityKey,
          actorUserId: requestedScope.actorUserId,
          projectId: requestedScope.projectId,
          organisationId: requestedScope.organisationId,
        },
        requestedScope,
      ),
    ).toBe(true);

    for (const key of Object.keys(requestedScope) as Array<
      keyof typeof requestedScope
    >) {
      expect(
        authorityScopeIsCurrent(
          { ...requestedScope, [key]: `${requestedScope[key]}-changed` },
          requestedScope,
        ),
      ).toBe(false);
    }
  });

  it("rejects missing or additional scope dimensions", () => {
    const { projectId: _projectId, ...missingProject } = requestedScope;
    const additionalDimension = {
      ...requestedScope,
      relationshipId: "relationship-1",
    };

    expect(
      authorityScopeIsCurrent(
        missingProject as typeof requestedScope,
        requestedScope,
      ),
    ).toBe(false);
    expect(
      authorityScopeIsCurrent(
        additionalDimension as typeof requestedScope,
        requestedScope,
      ),
    ).toBe(false);
  });

  it("throws the caller's exact fail-closed error after a scope change", () => {
    const message = "Authority changed while records loaded";

    expect(() =>
      assertAuthorityScopeCurrent(
        { ...requestedScope, actorUserId: "actor-2" },
        requestedScope,
        message,
      ),
    ).toThrowError(message);
    expect(() =>
      assertAuthorityScopeCurrent(
        { ...requestedScope },
        requestedScope,
        message,
      ),
    ).not.toThrow();
  });
});
