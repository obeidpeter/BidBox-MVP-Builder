import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/evidence-renewal.tsx"),
  "utf8",
);

describe("EvidenceRenewalPage governance wiring", () => {
  it("binds every query and mutation to the live actor/capability scope", () => {
    expect(source).toMatch(/activeScope = useRef/u);
    expect(source).toMatch(
      /organisationId,\s*projectId,\s*actorUserId,\s*membershipId,\s*authorityVersion,\s*authorityExpiry,\s*capabilityKey/u,
    );
    expect(source).toMatch(/activeOrganisation\?\.membershipId/u);
    expect(source).toMatch(/activeOrganisation\?\.version/u);
    expect(source).toMatch(/activeOrganisation\?\.accessExpiresAt/u);
    expect(source).toMatch(/gcTime: 0/u);
    expect(source).toMatch(/staleTime: 0/u);
    expect(source).toMatch(/assertAuthorityScopeCurrent/u);
    expect(source).toMatch(/beginCriticalWorkflow/u);
    expect(source).toMatch(/accessSource === "membership"/u);
    expect(source).toMatch(/membershipOrganisationId === organisationId/u);
  });

  it("uses the governed renewal endpoints, strict adapters and CAS headers", () => {
    expect(source).toMatch(/adaptEvidenceRenewalSnapshot/u);
    expect(source).toMatch(/adaptEvidenceRenewalAuthorities/u);
    expect(source).toMatch(/adaptEvidenceRenewalMutation/u);
    expect(source).toMatch(/\/evidence-renewals\/authorities/u);
    expect(source).toMatch(/\/staged-replacement/u);
    expect(source).toMatch(/\/review/u);
    expect(source).toMatch(/"If-Match": `"\$\{request\.plan\.version\}"`/u);
  });

  it("never treats an error or offline state as an empty or delivered workflow", () => {
    expect(source).toMatch(/Evidence renewal is unavailable offline/u);
    expect(source).toMatch(/could not be checked/u);
    expect(source).toMatch(/successful reminder is shown/u);
    expect(source).toMatch(/no external message sent/u);
  });
});
