import { describe, expect, it } from "vitest";
import { adaptWorkInbox } from "./work-inbox";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const key = "a".repeat(64);

function payload() {
  return {
    organisationId: ORG,
    generatedAt: "2026-08-12T12:00:00.000Z",
    businessTimeZone: "Africa/Lagos",
    limit: 2,
    truncated: true,
    restrictedContent: true,
    groups: {
      overdue: [
        {
          key,
          assignment: "owned",
          kind: "work_item",
          title: "Resolve evidence gap",
          projectTitle: "Pursuit Alpha",
          status: "in_progress",
          dueAt: "2026-08-11T12:00:00.000Z",
          priority: "high",
          href: `/pursuit-operations?project=${PROJECT}`,
        },
      ],
      today: [],
      upcoming: [],
      unscheduled: [],
    },
  };
}

describe("adaptWorkInbox", () => {
  it("accepts the exact tenant-bound grouped contract", () => {
    const result = adaptWorkInbox(payload(), ORG);
    expect(result.groups.overdue[0]).toMatchObject({
      key,
      title: "Resolve evidence gap",
    });
    expect(result.truncated).toBe(true);
  });

  it("rejects external and malformed deep links", () => {
    const value = payload();
    value.groups.overdue[0]!.href = "https://attacker.invalid/steal";
    expect(() => adaptWorkInbox(value, ORG)).toThrow(/link/u);
  });

  it("rejects total bound overflow, duplicate keys and unknown fields", () => {
    const overflow = payload();
    overflow.limit = 1;
    (
      overflow.groups.today as Array<(typeof overflow.groups.overdue)[number]>
    ).push({
      ...overflow.groups.overdue[0]!,
    });
    expect(() => adaptWorkInbox(overflow, ORG)).toThrow();

    const duplicate = payload();
    duplicate.limit = 2;
    (
      duplicate.groups.today as Array<(typeof duplicate.groups.overdue)[number]>
    ).push({
      ...duplicate.groups.overdue[0]!,
    });
    expect(() => adaptWorkInbox(duplicate, ORG)).toThrow(/collision/u);

    const unknown = payload() as ReturnType<typeof payload> & {
      rawId?: string;
    };
    unknown.rawId = PROJECT;
    expect(() => adaptWorkInbox(unknown, ORG)).toThrow(/contract/u);
  });
});
