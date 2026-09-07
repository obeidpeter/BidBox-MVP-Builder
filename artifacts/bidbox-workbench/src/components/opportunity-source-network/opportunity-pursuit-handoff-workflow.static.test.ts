import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "opportunity-pursuit-handoff-workflow.tsx"),
  "utf8",
);

it("partitions handoff reads by current membership and capability", () => {
  expect(source).toMatch(
    /queryKey[\s\S]*?activeMembershipId,[\s\S]*?capabilityFingerprint/u,
  );
  expect(source.match(/assertAuthorityScopeCurrent\(/gu)).toHaveLength(2);
  expect(source).toMatch(/beginCriticalWorkflow\(\)/u);
});

it("announces rejected confirmation without claiming a pursuit was created", () => {
  expect(source).toMatch(
    /confirm\.isError[\s\S]*?state="error"[\s\S]*?Pursuit handoff was not recorded/u,
  );
  expect(source).toMatch(/No pursuit was created/u);
});
