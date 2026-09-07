import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Footer,
  PageNumber,
  TableOfContents,
} from "docx";

import {
  ENGINE_VERSION,
  PROMPT_PACK_VERSION,
  MODEL_ID,
  TAXONOMY_VERSION,
} from "./provenance";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export { ENGINE_VERSION };

export const PROCESS_WARRANTY =
  "BidBox does not warrant contract award, evaluator behaviour, or acceptance of the package. BidBox warrants the reviewed process applied to the materials provided: requirement extraction, deterministic verification, and named human review.";

const NAVY = "1E3A5F";
const GREY = "666666";

/**
 * Minimal structural shapes for the report model: only the fields the DOCX and
 * PDF renderers actually read. Drizzle rows (and test fixtures) satisfy these
 * structurally; unused columns stay invisible to the renderers.
 */
export interface ReportProject {
  tenderTitle: string;
  issuingEntity?: string | null;
  tenderRef?: string | null;
  segment?: string | null;
  deadline?: string | null;
  valueBand?: string | null;
  status: string;
  redactionScope?: string | null;
  restrictedMode?: boolean;
  scope?: string | null;
  limitations?: string | null;
  responsivenessReview?: string | null;
  responsivenessSuggested?: boolean;
}

export interface ReportClient {
  name: string;
  ndaStatus?: string | null;
}

export interface ReportRequirement {
  id: string;
  text: string;
  category: string;
  isMandatory: boolean;
  sourceDocName?: string | null;
  clauseRef?: string | null;
  pageRef?: string | null;
  reviewStatus: string;
}

export interface ReportEvidence {
  requirementId: string;
  evidenceStatus: string;
  excerpt?: string | null;
  notes?: string | null;
  suggested: boolean;
}

export interface ReportDefect {
  description: string;
  type: string;
  severity: string;
  status: string;
  remediation?: string | null;
  owner?: string | null;
  suggested: boolean;
}

export interface ReportBoqCheck {
  lineRef?: string | null;
  checkType: string;
  finding: string;
  severity: string;
  status: string;
}

export interface ReportData {
  project: ReportProject;
  client: ReportClient | null;
  reviewerName: string | null;
  requirements: ReportRequirement[];
  evidence: ReportEvidence[];
  defects: ReportDefect[];
  boqChecks: ReportBoqCheck[];
  risk: {
    score: number;
    band: string;
    explanation: string;
    overrideBand?: string | null;
    overrideNote?: string | null;
    overrideBy?: string | null;
  };
  template?: { firmName: string; confidentialityLegend: string };
  version: number;
  generatedByName: string | null;
  /** Injectable for deterministic golden-file tests; defaults to now. */
  generatedAt?: Date;
}

const DEFAULT_TEMPLATE = {
  firmName: "BidBox",
  confidentialityLegend:
    "CONFIDENTIAL — Prepared for internal review. Not for external distribution.",
};

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, color: NAVY })],
  });
}

function subheading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, color: NAVY })],
  });
}

function para(
  text: string,
  opts: { italics?: boolean; bold?: boolean; color?: string } = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        italics: opts.italics,
        bold: opts.bold,
        color: opts.color,
      }),
    ],
  });
}

function cell(
  text: string,
  opts: { bold?: boolean; width?: number } = {},
): TableCell {
  return new TableCell({
    width: opts.width
      ? { size: opts.width, type: WidthType.PERCENTAGE }
      : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: text || "—", bold: opts.bold, size: 18 }),
        ],
      }),
    ],
  });
}

function makeTable(
  headers: string[],
  rows: string[][],
  widths?: number[],
): Table {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          cell(h, { bold: true, width: widths?.[i] }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => cell(c, { width: widths?.[i] })),
          }),
      ),
    ],
  });
}

export async function buildReportDocx(data: ReportData): Promise<Buffer> {
  const { project, client, requirements, evidence, defects, boqChecks, risk } =
    data;
  // Explicit locale + timezone: the deliverable is stamped in Nigerian local
  // time regardless of where the server runs, and the golden-file test stays
  // deterministic across environments.
  const generatedAt = (data.generatedAt ?? new Date()).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const template = data.template ?? DEFAULT_TEMPLATE;

  const children: (Paragraph | Table)[] = [];

  // Title block
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: template.firmName,
          bold: true,
          size: 40,
          color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: "Bid Autopsy Report",
          bold: true,
          size: 32,
          color: NAVY,
        }),
      ],
    }),
    para(`${project.tenderTitle}`, { bold: true }),
    para(
      `Client: ${client?.name ?? "—"}   |   Version ${data.version}   |   Generated ${generatedAt}`,
      { color: GREY },
    ),
    para(template.confidentialityLegend, { italics: true, color: GREY }),
  );

  // Document control block — a cross-reference header the reviewer and the
  // recipient can use to confirm they hold the correct, complete version.
  children.push(subheading("Document Control"));
  children.push(
    makeTable(
      ["Field", "Value"],
      [
        ["Document", `Bid Autopsy Report — ${project.tenderTitle}`],
        ["Report version", `v${data.version}`],
        ["Generated", generatedAt],
        ["Prepared by", data.generatedByName ?? "—"],
        ["Named reviewer", data.reviewerName ?? "—"],
        [
          "Engine / prompt pack / model",
          `${ENGINE_VERSION} · ${PROMPT_PACK_VERSION} · ${MODEL_ID}`,
        ],
        ["Defect taxonomy", TAXONOMY_VERSION],
        ["Classification", "CONFIDENTIAL — internal review only"],
      ],
      [30, 70],
    ),
  );

  // Table of contents. Word renders page numbers on first open / field
  // update; the heading styles below (HEADING_1/2) drive the entries.
  children.push(heading("Contents"));
  children.push(
    new TableOfContents("Contents", {
      hyperlink: true,
      headingStyleRange: "1-2",
    }),
  );
  children.push(
    para(
      "Right-click the contents above and choose “Update Field” to refresh page numbers.",
      {
        italics: true,
        color: GREY,
      },
    ),
  );

  // A. Engagement summary
  children.push(heading("A. Engagement Summary"));
  children.push(
    makeTable(
      ["Field", "Value"],
      [
        ["Client", client?.name ?? "—"],
        ["NDA status", client?.ndaStatus ?? "—"],
        ["Issuing entity", project.issuingEntity ?? "—"],
        ["Tender reference", project.tenderRef ?? "—"],
        ["Segment", project.segment ?? "—"],
        ["Deadline", project.deadline ?? "—"],
        ["Value band", project.valueBand ?? "—"],
        ["Reviewer", data.reviewerName ?? "—"],
        ["Status", project.status],
      ],
      [30, 70],
    ),
  );
  // FR-INT-03: a redacted or restricted engagement always carries its
  // limitation banner — the reader must know the findings do not cover
  // content excluded at intake.
  if (project.redactionScope || project.restrictedMode) {
    children.push(
      para(
        `LIMITATION — ${
          project.restrictedMode ? "Restricted-mode engagement. " : ""
        }Content was excluded or redacted at intake${
          project.redactionScope ? ` (scope: ${project.redactionScope})` : ""
        }. Findings in this report do not cover redacted or withheld material.`,
        { bold: true, color: GREY },
      ),
    );
  }
  if (project.scope) {
    children.push(subheading("Scope"), para(project.scope));
  }
  if (project.limitations) {
    children.push(subheading("Limitations"), para(project.limitations));
  }

  // Split each register into reviewer-confirmed items (which drive the risk
  // score and form the signed report body) and unconfirmed AI suggestions,
  // which are segregated so nothing counts until a named human confirms it.
  const confirmedReqs = requirements.filter(
    (r) => r.reviewStatus !== "suggested",
  );
  const suggestedReqs = requirements.filter(
    (r) => r.reviewStatus === "suggested",
  );
  const confirmedDefects = defects.filter((d) => !d.suggested);
  const suggestedDefects = defects.filter((d) => d.suggested);

  const requirementRow = (r: ReportRequirement) => [
    r.text,
    r.category,
    r.isMandatory ? "Yes" : "No",
    [r.sourceDocName, r.clauseRef, r.pageRef].filter(Boolean).join(" · ") ||
      "—",
    r.reviewStatus,
  ];
  const defectRow = (d: ReportDefect) => [
    d.description,
    d.type,
    d.severity,
    d.status,
    d.remediation ?? "—",
  ];

  // B. Requirement matrix
  children.push(heading("B. Requirement Matrix"));
  if (confirmedReqs.length === 0) {
    children.push(
      para("No reviewer-confirmed requirements recorded.", { italics: true }),
    );
  } else {
    children.push(
      makeTable(
        ["Requirement", "Category", "Mandatory", "Source", "Status"],
        confirmedReqs.map(requirementRow),
        [42, 15, 10, 20, 13],
      ),
    );
  }
  if (suggestedReqs.length > 0) {
    children.push(
      subheading(
        "Suggested requirements — pending named-reviewer confirmation",
      ),
    );
    children.push(
      para(
        `${suggestedReqs.length} AI-suggested requirement(s) below are not yet confirmed and do not contribute to the risk score.`,
        { italics: true, color: GREY },
      ),
    );
    children.push(
      makeTable(
        ["Requirement", "Category", "Mandatory", "Source", "Status"],
        suggestedReqs.map(requirementRow),
        [42, 15, 10, 20, 13],
      ),
    );
  }

  // Evidence trace: the excerpt-level provenance behind the matrix above.
  // Evidence-first doctrine — a requirement ruling without its mapped
  // excerpt is an assertion, not a finding.
  const reqTextById = new Map<string, string>(
    requirements.map((r) => [r.id, r.text]),
  );
  const confirmedEvidence = evidence.filter((e) => !e.suggested);
  const suggestedEvidence = evidence.filter((e) => e.suggested);
  const evidenceRow = (e: ReportEvidence) => [
    reqTextById.get(e.requirementId) ?? "—",
    e.evidenceStatus,
    e.excerpt ?? "—",
    e.notes ?? "—",
  ];
  children.push(subheading("Evidence trace"));
  if (confirmedEvidence.length === 0) {
    children.push(
      para("No confirmed evidence mappings recorded.", { italics: true }),
    );
  } else {
    children.push(
      makeTable(
        ["Requirement", "Status", "Excerpt", "Notes"],
        confirmedEvidence.map(evidenceRow),
        [30, 12, 38, 20],
      ),
    );
  }
  if (suggestedEvidence.length > 0) {
    children.push(
      para(
        `${suggestedEvidence.length} AI-suggested evidence mapping(s) below are not yet confirmed and do not contribute to the risk score.`,
        { italics: true, color: GREY },
      ),
    );
    children.push(
      makeTable(
        ["Requirement", "Status", "Excerpt", "Notes"],
        suggestedEvidence.map(evidenceRow),
        [30, 12, 38, 20],
      ),
    );
  }

  // C. Defect register
  children.push(heading("C. Defect Register"));
  if (confirmedDefects.length === 0) {
    children.push(
      para("No reviewer-confirmed defects recorded.", { italics: true }),
    );
  } else {
    children.push(
      makeTable(
        ["Description", "Type", "Severity", "Status", "Remediation"],
        confirmedDefects.map(defectRow),
        [34, 13, 13, 12, 28],
      ),
    );
  }
  if (suggestedDefects.length > 0) {
    children.push(
      subheading("Suggested defects — pending named-reviewer confirmation"),
    );
    children.push(
      para(
        `${suggestedDefects.length} AI-suggested defect(s) below are not yet confirmed and do not contribute to the risk score.`,
        { italics: true, color: GREY },
      ),
    );
    children.push(
      makeTable(
        ["Description", "Type", "Severity", "Status", "Remediation"],
        suggestedDefects.map(defectRow),
        [34, 13, 13, 12, 28],
      ),
    );
  }

  // D. Disqualification-risk score
  children.push(heading("D. Disqualification-Risk Score"));
  children.push(
    para(`Score: ${risk.score} / 100    Band: ${risk.band.toUpperCase()}`, {
      bold: true,
    }),
  );
  if (risk.overrideBand) {
    children.push(
      para(
        `Named-reviewer override: ${risk.overrideBand.toUpperCase()} by ${risk.overrideBy ?? "—"}. Note: ${risk.overrideNote ?? "—"}`,
        { color: GREY },
      ),
    );
  }
  children.push(para(risk.explanation));

  // E. Responsiveness review
  children.push(heading("E. Responsiveness Review"));
  if (project.responsivenessReview) {
    if (project.responsivenessSuggested) {
      children.push(
        para("Suggested narrative — pending named-reviewer confirmation.", {
          italics: true,
          color: GREY,
        }),
      );
    }
    for (const block of String(project.responsivenessReview).split("\n\n")) {
      if (block.trim()) children.push(para(block.trim()));
    }
  } else {
    children.push(
      para("No responsiveness review recorded.", { italics: true }),
    );
  }

  // F. BOQ verification annex
  children.push(heading("F. BOQ Verification Annex"));
  if (boqChecks.length === 0) {
    children.push(para("No BOQ checks recorded.", { italics: true }));
  } else {
    children.push(
      makeTable(
        ["Line", "Check", "Finding", "Severity", "Status"],
        boqChecks.map((b) => [
          b.lineRef ?? "—",
          b.checkType,
          b.finding,
          b.severity,
          b.status,
        ]),
        [10, 18, 42, 15, 15],
      ),
    );
  }

  // G. Remediation plan
  children.push(heading("G. Remediation Plan"));
  const remediable = confirmedDefects.filter((d) => d.status !== "waived");
  if (remediable.length === 0) {
    children.push(para("No outstanding remediation items.", { italics: true }));
  } else {
    children.push(
      makeTable(
        ["Defect", "Severity", "Owner", "Remediation", "Status"],
        remediable.map((d) => [
          d.description,
          d.severity,
          d.owner ?? "—",
          d.remediation ?? "—",
          d.status,
        ]),
        [30, 13, 15, 30, 12],
      ),
    );
  }

  // H. Copies manifest — the physical-submission control sheet. Nigerian
  // tenders are typically submitted as one clearly-marked Original plus a set
  // of copies; a missing or mislabelled copy is a common disqualifier, so the
  // package ships with an explicit tick-sheet.
  children.push(heading("H. Copies Manifest"));
  children.push(
    para(
      "Confirm each required hard copy is produced, correctly labelled, bound, and sealed before dispatch. Mark the number of copies against the tender instructions to bidders (ITB).",
      { italics: true, color: GREY },
    ),
  );
  const CHECK = "\u2610"; // ballot box
  children.push(
    makeTable(
      ["Copy", "Label on cover", "Bound", "Sealed", "Included"],
      [
        ["Original", "ORIGINAL", CHECK, CHECK, CHECK],
        ["Copy 1", "COPY", CHECK, CHECK, CHECK],
        ["Copy 2", "COPY", CHECK, CHECK, CHECK],
        ["Soft copy (if required)", "USB / CD — as ITB", CHECK, CHECK, CHECK],
      ],
      [26, 34, 13, 13, 14],
    ),
  );

  // I. Signature & seal checklist — the points across the package that a
  // named authorised signatory must sign and/or seal. Cross-references the
  // report sections above (see § letters) so the reviewer can trace each item.
  children.push(heading("I. Signature & Seal Checklist"));
  children.push(
    para(
      "Every point below must be signed and, where indicated, stamped with the company seal by an authorised signatory before submission.",
      { italics: true, color: GREY },
    ),
  );
  children.push(
    makeTable(
      ["Point", "Location / cross-reference", "Signed", "Sealed"],
      [
        [
          "Form of Tender / Bid submission sheet",
          "Tender document — Form of Tender",
          CHECK,
          CHECK,
        ],
        [
          "Price schedule / BOQ summary",
          "See § F. BOQ Verification Annex",
          CHECK,
          CHECK,
        ],
        [
          "Declaration of eligibility & non-collusion",
          "Tender document — Declarations",
          CHECK,
          CHECK,
        ],
        [
          "CAC & compliance certificate copies",
          "Certificate Vault artefacts",
          CHECK,
          CHECK,
        ],
        ["Each page initialled by signatory", "Full package", CHECK, "—"],
        [
          "Bid security / bank guarantee (if required)",
          "Tender document — Bid Security",
          CHECK,
          CHECK,
        ],
      ],
      [34, 34, 16, 16],
    ),
  );

  // J. Sign-off page
  children.push(heading("J. Sign-Off"));
  children.push(
    para(
      "This report is a DRAFT until a named reviewer signs off below. Export is blocked until sign-off is recorded.",
      { italics: true },
    ),
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({
          text: "Reviewer name: ______________________________",
          size: 22,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({
          text: "Attestation: ________________________________",
          size: 22,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({
          text: "Date: _______________________________________",
          size: 22,
        }),
      ],
    }),
  );

  children.push(
    new Paragraph({
      spacing: { before: 320 },
      children: [
        new TextRun({ text: "Process Warranty", bold: true, color: NAVY }),
      ],
    }),
    para(PROCESS_WARRANTY, { italics: true }),
    // Full provenance stamp (NFR-AUD-01): the signed deliverable names the
    // exact engine, prompt pack, and model configuration that produced it.
    para(
      `Engine: ${ENGINE_VERSION} · Prompt pack: ${PROMPT_PACK_VERSION} · Model: ${MODEL_ID} · Taxonomy: ${TAXONOMY_VERSION}`,
      { color: GREY },
    ),
  );

  const doc = new Document({
    creator: "BidBox Bid Autopsy Workbench",
    title: `Bid Autopsy Report — ${project.tenderTitle}`,
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `CONFIDENTIAL — ${template.firmName} Bid Autopsy Report — Page `,
                    size: 16,
                    color: GREY,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: GREY,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
