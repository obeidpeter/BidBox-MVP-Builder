import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanonicalEvidencePicker } from "./canonical-evidence-picker";

const DOCUMENT = "30000000-0000-4000-8000-000000000003";
const SHA = "a".repeat(64);
const options = [
  {
    documentId: DOCUMENT,
    projectId: "20000000-0000-4000-8000-000000000002",
    filename: "evidence.pdf",
    projectTitle: "Pursuit Alpha",
    sha256: SHA,
    versionNumber: 3,
    detectedMime: "application/pdf",
    sizeBytes: 256,
    privacyEligible: true,
  },
];

describe("CanonicalEvidencePicker", () => {
  it("is labelled and emits the canonical binding, never typed identifiers", () => {
    const onChange = vi.fn();
    render(
      <CanonicalEvidencePicker
        id="evidence"
        label="Governed evidence"
        options={options}
        value={[]}
        onChange={onChange}
      />,
    );
    const picker = screen.getByLabelText("Governed evidence");
    expect(picker).toBeRequired();
    fireEvent.change(picker, { target: { value: DOCUMENT } });
    expect(onChange).toHaveBeenCalledWith([
      { documentId: DOCUMENT, sha256: SHA },
    ]);
  });

  it("disables selection when no governed option exists", () => {
    render(
      <CanonicalEvidencePicker
        id="empty-evidence"
        label="Governed evidence"
        options={[]}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Governed evidence")).toBeDisabled();
    expect(
      screen.getByText(/No current document is available/iu),
    ).toBeInTheDocument();
  });

  it("preserves an out-of-window binding without exposing its identifier", () => {
    const retainedDocument = "40000000-0000-4000-8000-000000000004";
    render(
      <CanonicalEvidencePicker
        id="retained-evidence"
        label="Governed evidence"
        options={options}
        value={[{ documentId: retainedDocument, sha256: "b".repeat(64) }]}
        onChange={vi.fn()}
        truncated
      />,
    );
    const picker = screen.getByLabelText("Governed evidence");
    expect(picker).toHaveValue(retainedDocument);
    expect(
      screen.getByRole("option", {
        name: "Previously attached document 1 — checked again on submit",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(retainedDocument)).not.toBeInTheDocument();
    expect(
      screen.getByText(/most recent eligible documents/u),
    ).toBeInTheDocument();
  });

  it("uses convenience-only copy for retained and truncated privacy evidence", () => {
    const note =
      "This picker copies a digest snapshot; it is not a mutation-time attestation.";
    render(
      <CanonicalEvidencePicker
        id="privacy-snapshot"
        label="Privacy evidence"
        options={options}
        value={[
          {
            documentId: "50000000-0000-4000-8000-000000000005",
            sha256: "c".repeat(64),
          },
        ]}
        onChange={vi.fn()}
        truncated
        verificationNote={note}
      />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Previously attached document 1 — saved verification record",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/checked again on submit/iu),
    ).not.toBeInTheDocument();
  });
});
