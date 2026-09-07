import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  adaptPrivacyOperationsDashboard,
  type PrivacyOperationsDashboard,
} from "./privacy-operations-contract";
import { PrivacyOperationsDashboardView } from "./privacy-operations-dashboard";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";

function dashboard(): PrivacyOperationsDashboard {
  return {
    generatedAt: "2026-08-11T12:00:00.000Z",
    organisationId: ORGANISATION_ID,
    boundedTo: 25,
    legalDecisionAutomated: false,
    rawSubjectPiiIncluded: false,
    authorityNote:
      "Named humans decide; this centre cannot release a hold or delete data.",
    totals: {
      dataSubjectRequests: 2,
      consentRecords: 1,
      legalHolds: 1,
      subprocessors: 0,
      crossBorderTransfers: 0,
      deletionActions: 0,
    },
    truncated: {
      dataSubjectRequests: false,
      consentRecords: false,
      legalHolds: false,
      subprocessors: false,
      crossBorderTransfers: false,
      deletionActions: false,
    },
    dataSubjectRequests: [],
    consentRecords: [],
    legalHolds: [],
    subprocessors: [],
    crossBorderTransfers: [],
    deletionActions: [],
    blockers: ["1 loaded request is overdue for named-human handling."],
  };
}

describe("PrivacyOperationsDashboardView", () => {
  it("shows bounded totals, blockers and explicit privacy minimisation", () => {
    render(<PrivacyOperationsDashboardView dashboard={dashboard()} />);
    expect(
      screen.getByRole("heading", { name: "Privacy requests" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Personal details:")).toBeInTheDocument();
    expect(
      screen.getByText("1 loaded request is overdue for named-human handling."),
    ).toBeInTheDocument();
    expect(screen.getByText("Data-subject requests")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No data-subject requests are available for this organisation.",
      ),
    ).toBeInTheDocument();
  });

  it("runtime adapter rejects subject references and automated legal claims", () => {
    expect(() =>
      adaptPrivacyOperationsDashboard(
        { ...dashboard(), requesterReference: "raw-subject@example.test" },
        ORGANISATION_ID,
      ),
    ).toThrow(/Invalid privacy operations response/u);
    expect(() =>
      adaptPrivacyOperationsDashboard(
        { ...dashboard(), legalDecisionAutomated: true },
        ORGANISATION_ID,
      ),
    ).toThrow(/Invalid privacy operations response/u);
    expect(
      adaptPrivacyOperationsDashboard(dashboard(), ORGANISATION_ID)
        .rawSubjectPiiIncluded,
    ).toBe(false);
  });
});
