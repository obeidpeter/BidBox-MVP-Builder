import { describe, expect, it } from "vitest";
import { adaptProductionAcceptanceAuthorities } from "./production-acceptance-contract";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";

function response(overrides: Record<string, unknown> = {}) {
  return {
    organisationId: ORGANISATION_ID,
    items: [{ userId: OWNER_ID, name: "Migration Owner" }],
    limit: 100,
    truncated: false,
    ...overrides,
  };
}

describe("production acceptance authority adapter", () => {
  it("accepts only the exact tenant-bound bounded directory shape", () => {
    expect(
      adaptProductionAcceptanceAuthorities(response(), ORGANISATION_ID),
    ).toEqual(response());
  });

  it("rejects cross-tenant, duplicate, malformed, and unnamed authorities", () => {
    expect(() =>
      adaptProductionAcceptanceAuthorities(
        response({ organisationId: "another-organisation" }),
        ORGANISATION_ID,
      ),
    ).toThrow();
    expect(() =>
      adaptProductionAcceptanceAuthorities(
        response({
          items: [
            { userId: OWNER_ID, name: "Migration Owner" },
            { userId: OWNER_ID, name: "Another Name" },
          ],
        }),
        ORGANISATION_ID,
      ),
    ).toThrow();
    expect(() =>
      adaptProductionAcceptanceAuthorities(
        response({ items: [{ userId: "not-a-uuid", name: "Owner" }] }),
        ORGANISATION_ID,
      ),
    ).toThrow();
    expect(() =>
      adaptProductionAcceptanceAuthorities(
        response({ items: [{ userId: OWNER_ID, name: " Owner " }] }),
        ORGANISATION_ID,
      ),
    ).toThrow();
  });
});
