import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientActionSource = readFileSync(
  resolve(import.meta.dirname, "client-action-portal-route.tsx"),
  "utf8",
);
const consortiumSource = readFileSync(
  resolve(import.meta.dirname, "partner-consortium-room-route.tsx"),
  "utf8",
);
const operationsSource = readFileSync(
  resolve(import.meta.dirname, "pursuit-operations-suite-route.tsx"),
  "utf8",
);

function sourceBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("authority-scoped query caches", () => {
  it("partitions Client Action reads by actor and capability state", () => {
    const snapshotBlock = sourceBlock(
      clientActionSource,
      "const queryKey = [",
      "const authorityQueryKey = [",
    );
    const authorityBlock = sourceBlock(
      clientActionSource,
      "const authorityQueryKey = [",
      "const mutation = useMutation",
    );
    const mutationBlock = sourceBlock(
      clientActionSource,
      "const mutation = useMutation",
      "if (!canAccess)",
    );
    expect(snapshotBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(snapshotBlock).toContain("enabled: canView && Boolean(actorUserId)");
    expect(snapshotBlock).toContain("assertAuthorityScopeCurrent(");
    expect(snapshotBlock).toContain(
      "Client action authority changed while records loaded",
    );
    expect(authorityBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(authorityBlock).toContain("assertAuthorityScopeCurrent(");
    expect(authorityBlock).toContain(
      "Client action scope changed while authorities loaded",
    );
    expect(mutationBlock).toContain("assertAuthorityScopeCurrent(");
    expect(mutationBlock).toContain(
      "Client action scope changed while action completed",
    );
    expect(mutationBlock).toContain("beginCriticalWorkflow()");
    expect(mutationBlock).toMatch(/finally\s*\{[\s\S]*release\?\.\(\);/u);
    expect(
      clientActionSource.match(/assertAuthorityScopeCurrent\(/gu),
    ).toHaveLength(5);
    expect(clientActionSource).not.toContain(
      "activeScope.current.actorUserId !==",
    );
    expect(clientActionSource).toContain(
      "key={`${organisationId}:${membershipId}:${accessVersion}:${projectId}:${actorUserId}:${capabilityKey}`}",
    );
  });

  it("partitions consortium rooms and participant names by current authority", () => {
    const snapshotBlock = sourceBlock(
      consortiumSource,
      "const queryKey = [",
      "const participantQueryKey = [",
    );
    const participantBlock = sourceBlock(
      consortiumSource,
      "const participantQueryKey = [",
      "const mutation = useMutation",
    );
    const mutationBlock = sourceBlock(
      consortiumSource,
      "const mutation = useMutation",
      "if (!canRead)",
    );
    expect(snapshotBlock).toContain("assertAuthorityScopeCurrent(");
    expect(snapshotBlock).toContain(
      "Consortium scope changed while the room loaded",
    );
    expect(participantBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(participantBlock).toContain("assertAuthorityScopeCurrent(");
    expect(participantBlock).toContain(
      "Consortium scope changed while participants loaded",
    );
    expect(mutationBlock).toContain("assertAuthorityScopeCurrent(");
    expect(mutationBlock).toContain(
      "Consortium scope changed while the action completed",
    );
    expect(mutationBlock).toContain("beginCriticalWorkflow()");
    expect(mutationBlock).toMatch(/finally\s*\{[\s\S]*release\?\.\(\);/u);
    expect(participantBlock).toContain(
      "enabled: canView && canWrite && Boolean(actorUserId)",
    );
    expect(
      consortiumSource.match(/assertAuthorityScopeCurrent\(/gu),
    ).toHaveLength(5);
    expect(consortiumSource).not.toContain(
      "activeScope.current.actorUserId !==",
    );
    expect(consortiumSource).toContain(
      "key={`${organisationId}:${projectId}:${relationshipId}:${actorUserId}:${capabilityKey}`}",
    );
  });

  it("requires a named actor and readable-kind fingerprint for the mobile queue", () => {
    const suiteBlock = sourceBlock(
      operationsSource,
      "const suiteQuery = useQuery",
      "const mobileQueueQuery = useQuery",
    );
    const mobileBlock = sourceBlock(
      operationsSource,
      "const mobileQueueQuery = useQuery",
      "const packageVersionQuery = useQuery",
    );
    const mutationScopeBlock = sourceBlock(
      operationsSource,
      "const activeMutationScope = useRef",
      "const refreshAfterMutation",
    );
    expect(suiteBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(suiteBlock).toContain("assertAuthorityScopeCurrent(");
    expect(suiteBlock).toContain(
      "Operations authority changed while records loaded",
    );
    expect(mobileBlock).toMatch(/actorUserId,[\s\S]*capabilityKey,/u);
    expect(mobileBlock).toContain(
      "enabled: Boolean(compactMode && canRead && projectId && actorUserId)",
    );
    expect(mobileBlock).toContain("assertAuthorityScopeCurrent(");
    expect(mobileBlock).toContain(
      "Operations authority changed while queue loaded",
    );
    expect(mutationScopeBlock).toContain("assertAuthorityScopeCurrent(");
    expect(mutationScopeBlock).toContain(
      "Pursuit changed while the operation was recorded",
    );
    expect(mutationScopeBlock).toContain("beginCriticalWorkflow()");
    expect(mutationScopeBlock).toMatch(
      /finally\s*\{[\s\S]*releaseCriticalWorkflow\?\.\(\);/u,
    );
    expect(
      operationsSource.match(/assertAuthorityScopeCurrent\(/gu),
    ).toHaveLength(7);
    expect(operationsSource).not.toContain(
      "activeMutationScope.current.actorUserId !==",
    );
    expect(operationsSource).toContain(
      "key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}",
    );
    expect(
      operationsSource.match(/(?:^|\s)disabled=\{operationPending\}/gu),
    ).toHaveLength(1);
    expect(operationsSource).toContain("aria-disabled={operationPending}");
    expect(operationsSource).toMatch(
      /if \(projectsQuery\.isLoading \|\| meQuery\.isLoading\)/u,
    );
  });
});
