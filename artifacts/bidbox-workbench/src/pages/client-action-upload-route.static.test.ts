import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "client-action-portal-route.tsx"),
  "utf8",
);

describe("Client Action governed upload route", () => {
  it("keeps raw bytes on the server-issued signed PUT and metadata on API calls", () => {
    expect(source).toContain("runClientActionUpload(input");
    expect(source).toMatch(
      /putSignedObject:\s*\(uploadUrl, init\) => fetch\(uploadUrl, init\)/u,
    );
    expect(source).toMatch(
      /issueLease:[\s\S]*expectedVersion: binding\.expectedRecordVersion,[\s\S]*intentId: binding\.intentId/u,
    );
    expect(source).toMatch(
      /finalize:[\s\S]*expectedVersion: binding\.expectedRecordVersion,[\s\S]*intentId: binding\.intentId/u,
    );
    expect(source).not.toMatch(
      /JSON\.stringify\([^)]*(?:file|bytes|arrayBuffer)/u,
    );
  });

  it("holds the critical workflow through receipt handling and blocks parallel/project switches", () => {
    expect(source).toMatch(
      /uploadInFlightRef\.current = true;[\s\S]*beginCriticalWorkflow\(\)[\s\S]*try \{[\s\S]*runClientActionUpload[\s\S]*finally \{[\s\S]*release\?\.\(\);[\s\S]*uploadInFlightRef\.current = false/u,
    );
    expect(source).toContain("disabled={mutation.isPending || uploadInFlight}");
  });

  it("rechecks membership, tenant, project, actor, capability and exact snapshot target", () => {
    for (const field of [
      "organisationId",
      "projectId",
      "actorUserId",
      "capabilityKey",
      "membershipId",
      "membershipOrganisationId",
      "accessSource",
      "accessVersion",
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("assertAuthorityScopeCurrent(");
    expect(source).toContain("assertClientActionUploadTargetCurrent(");
  });
});
