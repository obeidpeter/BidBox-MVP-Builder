import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocalUser } from "../accessContext";
import type { GrowthSuiteScope } from "./contracts";
import { deriveOnboardingJourney } from "./onboarding";
import {
  DrizzleOnboardingProgressRepository,
  OnboardingProgressUnavailableError,
  reduceOnboardingProgress,
  type AuthorisedActor,
  type OnboardingProgressDriver,
  type ProgressEventRow,
  type ProgressTransaction,
} from "./onboardingProgress";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-11T10:00:00.000Z");

function details(
  itemId: string,
  completed: boolean,
  previousVersion: number,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    journeyVersion: "2026-08-11.2",
    itemId,
    previousVersion,
    completed,
  });
}

function actor(): AuthorisedActor {
  const roles = ["bid_manager"] as const;
  return {
    user: {
      id: ACTOR_ID,
      clerkUserId: "clerk-actor",
      email: "actor@example.invalid",
      name: "Named Bid Manager",
      role: "none",
      status: "active",
      lastLoginAt: null,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies LocalUser,
    roles,
    journey: deriveOnboardingJourney(roles),
  };
}

class FakeTransaction implements ProgressTransaction {
  readonly events: ProgressEventRow[] = [];
  authorisedActor: AuthorisedActor | null = actor();
  lockCount = 0;

  async lock(): Promise<void> {
    this.lockCount += 1;
  }

  async loadAuthorisedActor(): Promise<AuthorisedActor | null> {
    return this.authorisedActor;
  }

  async loadEvents(): Promise<readonly ProgressEventRow[]> {
    return [...this.events];
  }

  async appendEvent(
    _scope: GrowthSuiteScope,
    _actor: LocalUser,
    eventType:
      | "growth_suite.onboarding_item_completed"
      | "growth_suite.onboarding_item_reopened"
      | "growth_suite.onboarding_practice_marker_saved"
      | "growth_suite.onboarding_practice_marker_removed",
    eventDetails: string,
  ): Promise<void> {
    this.events.push({
      seq: this.events.length + 1,
      eventType,
      details: eventDetails,
    });
  }
}

function repository(transaction = new FakeTransaction()) {
  const driver: OnboardingProgressDriver = {
    transaction: async (_organisationId, callback) => callback(transaction),
  };
  return {
    transaction,
    repository: new DrizzleOnboardingProgressRepository({
      driver,
      now: () => NOW,
    }),
  };
}

describe("durable onboarding progress", () => {
  test("reduces ordered audit receipts and ignores no-longer-applicable role items", () => {
    const progress = reduceOnboardingProgress(
      deriveOnboardingJourney(["bid_manager"]),
      [
        {
          seq: 1,
          eventType: "growth_suite.onboarding_item_completed",
          details: details("confirm-active-workspace", true, 0),
        },
        {
          seq: 2,
          eventType: "growth_suite.onboarding_item_completed",
          details: details("triage-synthetic-queue", true, 1),
        },
        {
          seq: 3,
          eventType: "growth_suite.onboarding_item_reopened",
          details: details("confirm-active-workspace", false, 2),
        },
      ],
    );
    assert.deepEqual(progress.savedPracticeMarkerItemIds, []);
    assert.deepEqual(progress.completedItemIds, []);
    assert.equal(progress.version, 3);
  });

  test("writes a neutral version-bound practice marker and rejects stale replay", async () => {
    const fixture = repository();
    const scope = { organisationId: ORGANISATION_ID, actorUserId: ACTOR_ID };
    const first = await fixture.repository.mutateProgress(
      scope,
      ["bid_manager"],
      {
        journeyVersion: "2026-08-11.2",
        itemId: "confirm-active-workspace",
        expectedVersion: 0,
        markerSaved: true,
      },
    );
    assert.equal(first.outcome, "updated");
    assert.deepEqual(
      first.outcome === "updated"
        ? first.progress.savedPracticeMarkerItemIds
        : [],
      ["confirm-active-workspace"],
    );
    assert.equal(fixture.transaction.lockCount, 1);
    assert.equal(
      fixture.transaction.events[0]?.eventType,
      "growth_suite.onboarding_practice_marker_saved",
    );
    assert.deepEqual(JSON.parse(fixture.transaction.events[0]!.details!), {
      schemaVersion: 2,
      journeyVersion: "2026-08-11.2",
      itemId: "confirm-active-workspace",
      previousVersion: 0,
      markerSaved: true,
    });

    const replay = await fixture.repository.mutateProgress(
      scope,
      ["bid_manager"],
      {
        journeyVersion: "2026-08-11.2",
        itemId: "review-authority-boundaries",
        expectedVersion: 0,
        markerSaved: true,
      },
    );
    assert.deepEqual(replay, { outcome: "not_found_or_conflict" });
  });

  test("fails closed when current tenant roles differ from the request context", async () => {
    const fixture = repository();
    await assert.rejects(
      fixture.repository.getProgress(
        { organisationId: ORGANISATION_ID, actorUserId: ACTOR_ID },
        ["read_only_auditor"],
      ),
      OnboardingProgressUnavailableError,
    );
  });

  test("rejects malformed or reordered audit receipts", () => {
    assert.throws(
      () =>
        reduceOnboardingProgress(deriveOnboardingJourney(["bid_manager"]), [
          {
            seq: 2,
            eventType: "growth_suite.onboarding_item_completed",
            details: details("confirm-active-workspace", true, 0),
          },
          {
            seq: 1,
            eventType: "growth_suite.onboarding_item_reopened",
            details: details("confirm-active-workspace", false, 1),
          },
        ]),
      OnboardingProgressUnavailableError,
    );
  });
});
