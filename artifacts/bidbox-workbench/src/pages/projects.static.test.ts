import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src", "pages", "projects.tsx"),
  "utf8",
);

describe("project register source controls", () => {
  it("does not claim creation-time authority over the commercial gate", () => {
    expect(source).not.toContain("paymentStatus");
    expect(source).not.toContain("Payment Gate");
    expect(source).toContain("Every new pursuit starts with payment pending");
    expect(source).toContain("it cannot be changed here");
  });

  it("never silently chooses a reviewer", () => {
    expect(source).not.toContain("reviewerOptions[0]");
    expect(source).not.toContain("firstReviewer");
    expect(source).not.toContain("useGetMe");
    expect(source).toContain('reviewerId: ""');
    expect(source).toContain("!selectedReviewerEligible");
    expect(source).toContain("user.reviewerEligible === true");
    expect(source).toContain('user.membershipStatus === "active"');
    expect(source).toContain("retainEligibleSelectionId(selectedClientId");
  });

  it("keeps paired creation fields mobile-safe and register filters URL-backed", () => {
    expect(source).not.toContain('className="grid grid-cols-2 gap-4"');
    expect(source).toContain("grid grid-cols-1 gap-4 sm:grid-cols-2");
    expect(source).toContain("max-h-[calc(100dvh-2rem)]");
    expect(source).toContain("w-[calc(100vw-2rem)] overflow-y-auto");
    expect(source).toContain("useSearchParams");
    expect(source).toContain("maxLength={SEARCH_LIMIT}");
    expect(source).toContain("filterAndSortProjects");
  });

  it("normalises deadline input as WAT and keeps time filters live", () => {
    expect(source).toContain("Submission Deadline (WAT)");
    expect(source).toContain("deadlineInputToIsoWat(data.deadline)");
    expect(source).toContain("REGISTER_CLOCK_INTERVAL_MS");
    expect(source).toContain("window.setInterval");
  });
});
