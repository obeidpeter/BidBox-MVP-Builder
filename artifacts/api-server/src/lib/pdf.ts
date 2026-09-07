import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import { ENGINE_VERSION, PROMPT_PACK_VERSION, MODEL_ID } from "./provenance";
import { PROCESS_WARRANTY, type ReportData } from "./docx";

export const PDF_MIME = "application/pdf";

const NAVY: RGB = rgb(0x1e / 255, 0x3a / 255, 0x5f / 255);
const GREY: RGB = rgb(0x66 / 255, 0x66 / 255, 0x66 / 255);
const BLACK: RGB = rgb(0.1, 0.1, 0.1);
const BORDER: RGB = rgb(0.8, 0.8, 0.8);
const HEADER_BG: RGB = rgb(0.93, 0.93, 0.93);

// A4 in PDF points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TEXT = "CONFIDENTIAL — BidBox Bid Autopsy Report — Page ";

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/**
 * A stateful, top-to-bottom PDF layout cursor. pdf-lib is a low-level drawing
 * library with no concept of flow layout, so this class tracks the vertical
 * cursor, breaks pages when content overflows, wraps text to the content width,
 * and draws simple bordered tables — mirroring the sections the DOCX report
 * (`lib/docx.ts`) produces so the two exports carry identical content.
 */
class Layout {
  doc: PDFDocument;
  fonts: Fonts;
  page!: PDFPage;
  y = 0;
  pageNumber = 0;
  footerText: string;
  private pages: PDFPage[] = [];

  constructor(
    doc: PDFDocument,
    fonts: Fonts,
    footerText: string = FOOTER_TEXT,
  ) {
    this.doc = doc;
    this.fonts = fonts;
    this.footerText = footerText;
    this.addPage();
  }

  private addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.pageNumber += 1;
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN + 24) {
      this.addPage();
    }
  }

  private wrap(
    text: string,
    font: PDFFont,
    size: number,
    maxWidth: number,
  ): string[] {
    const clean = (text ?? "").replace(/\r/g, "");
    const outLines: string[] = [];
    for (const rawLine of clean.split("\n")) {
      const words = rawLine.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        outLines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
          // A single word longer than the column is hard-broken by character so
          // it never overflows the cell boundary.
          if (!line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            let chunk = "";
            for (const ch of word) {
              if (
                font.widthOfTextAtSize(chunk + ch, size) > maxWidth &&
                chunk
              ) {
                outLines.push(chunk);
                chunk = ch;
              } else {
                chunk += ch;
              }
            }
            line = chunk;
          } else {
            line = candidate;
          }
        } else {
          outLines.push(line);
          line = word;
        }
      }
      if (line) outLines.push(line);
    }
    return outLines.length ? outLines : [""];
  }

  gap(height: number) {
    this.y -= height;
  }

  text(
    content: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: RGB;
      after?: number;
      indent?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fonts.regular;
    const color = opts.color ?? BLACK;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.35;
    const lines = this.wrap(content, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color,
      });
      this.y -= lineHeight;
    }
    this.y -= opts.after ?? 6;
  }

  heading(text: string) {
    this.ensure(30);
    this.gap(10);
    this.text(text, { size: 15, font: this.fonts.bold, color: NAVY, after: 6 });
  }

  subheading(text: string) {
    this.ensure(24);
    this.gap(4);
    this.text(text, { size: 12, font: this.fonts.bold, color: NAVY, after: 4 });
  }

  table(headers: string[], rows: string[][], weights?: number[]) {
    const cols = headers.length;
    const w =
      weights && weights.length === cols ? weights : headers.map(() => 1);
    const totalWeight = w.reduce((a, b) => a + b, 0);
    const colWidths = w.map((x) => (x / totalWeight) * CONTENT_WIDTH);
    const fontSize = 8.5;
    const cellPadX = 4;
    const cellPadY = 4;
    const lineHeight = fontSize * 1.3;

    const drawRow = (cells: string[], isHeader: boolean) => {
      const font = isHeader ? this.fonts.bold : this.fonts.regular;
      const wrapped = cells.map((c, i) =>
        this.wrap(
          c && c.length ? c : "—",
          font,
          fontSize,
          colWidths[i] - cellPadX * 2,
        ),
      );
      const rowLines = Math.max(...wrapped.map((lines) => lines.length));
      const rowHeight = rowLines * lineHeight + cellPadY * 2;

      // Keep each row atomic: if it won't fit, break to a fresh page and
      // reprint the header there so long tables stay readable.
      if (this.y - rowHeight < MARGIN + 24) {
        this.addPage();
        if (!isHeader) drawRow(headers, true);
      }

      const top = this.y;
      let x = MARGIN;
      for (let i = 0; i < cols; i++) {
        if (isHeader) {
          this.page.drawRectangle({
            x,
            y: top - rowHeight,
            width: colWidths[i],
            height: rowHeight,
            color: HEADER_BG,
          });
        }
        this.page.drawRectangle({
          x,
          y: top - rowHeight,
          width: colWidths[i],
          height: rowHeight,
          borderColor: BORDER,
          borderWidth: 0.5,
        });
        let ty = top - cellPadY - fontSize;
        for (const line of wrapped[i]) {
          this.page.drawText(line, {
            x: x + cellPadX,
            y: ty,
            size: fontSize,
            font,
            color: isHeader ? NAVY : BLACK,
          });
          ty -= lineHeight;
        }
        x += colWidths[i];
      }
      this.y = top - rowHeight;
    };

    this.ensure(lineHeight * 2 + cellPadY * 2);
    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);
    this.y -= 8;
  }

  finalize() {
    // Footer with page numbers, drawn once every page is laid out so the
    // "Page N of M"-style running footer matches the DOCX confidential footer.
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      const label = `${this.footerText}${i + 1}`;
      const size = 7;
      const width = this.fonts.regular.widthOfTextAtSize(label, size);
      p.drawText(label, {
        x: (PAGE_WIDTH - width) / 2,
        y: MARGIN - 20,
        size,
        font: this.fonts.regular,
        color: GREY,
      });
    }
  }
}

export async function buildReportPdf(data: ReportData): Promise<Buffer> {
  const { project, client, requirements, evidence, defects, boqChecks, risk } =
    data;
  const template = data.template ?? {
    firmName: "BidBox",
    confidentialityLegend:
      "CONFIDENTIAL — Prepared for internal review. Not for external distribution.",
  };

  const doc = await PDFDocument.create();
  doc.setTitle(`Bid Autopsy Report — ${project.tenderTitle}`);
  doc.setCreator(`${template.firmName} Bid Autopsy Workbench`);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const L = new Layout(
    doc,
    fonts,
    `CONFIDENTIAL — ${template.firmName} Bid Autopsy Report — Page `,
  );

  // Title block
  L.text(template.firmName, {
    size: 22,
    font: fonts.bold,
    color: NAVY,
    after: 2,
  });
  L.text("Bid Autopsy Report", {
    size: 17,
    font: fonts.bold,
    color: NAVY,
    after: 6,
  });
  L.text(project.tenderTitle, { size: 10, font: fonts.bold, after: 4 });
  L.text(
    `Client: ${client?.name ?? "—"}   |   Version ${data.version}   |   Generated ${new Date().toLocaleString()}`,
    { size: 9, color: GREY, after: 4 },
  );
  L.text(template.confidentialityLegend, {
    size: 9,
    font: fonts.italic,
    color: GREY,
    after: 6,
  });

  // Document control
  L.subheading("Document Control");
  L.table(
    ["Field", "Value"],
    [
      ["Document", `Bid Autopsy Report — ${project.tenderTitle}`],
      ["Report version", `v${data.version}`],
      ["Generated", new Date().toLocaleString()],
      ["Prepared by", data.generatedByName ?? "—"],
      ["Named reviewer", data.reviewerName ?? "—"],
      [
        "Engine / prompt pack / model",
        `${ENGINE_VERSION} · ${PROMPT_PACK_VERSION} · ${MODEL_ID}`,
      ],
      ["Classification", "CONFIDENTIAL — internal review only"],
    ],
    [30, 70],
  );

  // Contents. The DOCX uses a Word auto-updating table-of-contents field;
  // PDF has no live-field equivalent, so this renders the same section list
  // statically for content parity.
  L.heading("Contents");
  for (const entry of [
    "A. Engagement Summary",
    "B. Requirement Matrix",
    "C. Defect Register",
    "D. Disqualification-Risk Score",
    "E. Responsiveness Review",
    "F. BOQ Verification Annex",
    "G. Remediation Plan",
    "H. Copies Manifest",
    "I. Signature & Seal Checklist",
    "J. Sign-Off",
  ]) {
    L.text(entry, { size: 10, indent: 12, after: 2 });
  }
  L.text("Sections follow in the order listed above.", {
    font: fonts.italic,
    color: GREY,
  });

  // A. Engagement summary
  L.heading("A. Engagement Summary");
  L.table(
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
  );
  if (project.scope) {
    L.subheading("Scope");
    L.text(project.scope);
  }
  if (project.limitations) {
    L.subheading("Limitations");
    L.text(project.limitations);
  }

  const confirmedReqs = requirements.filter(
    (r) => r.reviewStatus !== "suggested",
  );
  const suggestedReqs = requirements.filter(
    (r) => r.reviewStatus === "suggested",
  );
  const confirmedDefects = defects.filter((d) => !d.suggested);
  const suggestedDefects = defects.filter((d) => d.suggested);

  const requirementRow = (r: any) => [
    r.text,
    r.category,
    r.isMandatory ? "Yes" : "No",
    [r.sourceDocName, r.clauseRef, r.pageRef].filter(Boolean).join(" · ") ||
      "—",
    r.reviewStatus,
  ];
  const defectRow = (d: any) => [
    d.description,
    d.type,
    d.severity,
    d.status,
    d.remediation ?? "—",
  ];

  // B. Requirement matrix
  L.heading("B. Requirement Matrix");
  if (confirmedReqs.length === 0) {
    L.text("No reviewer-confirmed requirements recorded.", {
      font: fonts.italic,
    });
  } else {
    L.table(
      ["Requirement", "Category", "Mandatory", "Source", "Status"],
      confirmedReqs.map(requirementRow),
      [42, 15, 10, 20, 13],
    );
  }
  if (suggestedReqs.length > 0) {
    L.subheading(
      "Suggested requirements — pending named-reviewer confirmation",
    );
    L.text(
      `${suggestedReqs.length} AI-suggested requirement(s) below are not yet confirmed and do not contribute to the risk score.`,
      { font: fonts.italic, color: GREY },
    );
    L.table(
      ["Requirement", "Category", "Mandatory", "Source", "Status"],
      suggestedReqs.map(requirementRow),
      [42, 15, 10, 20, 13],
    );
  }

  // Evidence trace
  const reqTextById = new Map<string, string>(
    requirements.map((r: any) => [r.id, r.text]),
  );
  const confirmedEvidence = evidence.filter((e) => !e.suggested);
  const suggestedEvidence = evidence.filter((e) => e.suggested);
  const evidenceRow = (e: any) => [
    reqTextById.get(e.requirementId) ?? "—",
    e.evidenceStatus,
    e.excerpt ?? "—",
    e.notes ?? "—",
  ];
  L.subheading("Evidence trace");
  if (confirmedEvidence.length === 0) {
    L.text("No confirmed evidence mappings recorded.", { font: fonts.italic });
  } else {
    L.table(
      ["Requirement", "Status", "Excerpt", "Notes"],
      confirmedEvidence.map(evidenceRow),
      [30, 12, 38, 20],
    );
  }
  if (suggestedEvidence.length > 0) {
    L.text(
      `${suggestedEvidence.length} AI-suggested evidence mapping(s) below are not yet confirmed and do not contribute to the risk score.`,
      { font: fonts.italic, color: GREY },
    );
    L.table(
      ["Requirement", "Status", "Excerpt", "Notes"],
      suggestedEvidence.map(evidenceRow),
      [30, 12, 38, 20],
    );
  }

  // C. Defect register
  L.heading("C. Defect Register");
  if (confirmedDefects.length === 0) {
    L.text("No reviewer-confirmed defects recorded.", { font: fonts.italic });
  } else {
    L.table(
      ["Description", "Type", "Severity", "Status", "Remediation"],
      confirmedDefects.map(defectRow),
      [34, 13, 13, 12, 28],
    );
  }
  if (suggestedDefects.length > 0) {
    L.subheading("Suggested defects — pending named-reviewer confirmation");
    L.text(
      `${suggestedDefects.length} AI-suggested defect(s) below are not yet confirmed and do not contribute to the risk score.`,
      { font: fonts.italic, color: GREY },
    );
    L.table(
      ["Description", "Type", "Severity", "Status", "Remediation"],
      suggestedDefects.map(defectRow),
      [34, 13, 13, 12, 28],
    );
  }

  // D. Disqualification-risk score
  L.heading("D. Disqualification-Risk Score");
  L.text(`Score: ${risk.score} / 100    Band: ${risk.band.toUpperCase()}`, {
    font: fonts.bold,
  });
  if (risk.overrideBand) {
    L.text(
      `Named-reviewer override: ${risk.overrideBand.toUpperCase()} by ${risk.overrideBy ?? "—"}. Note: ${risk.overrideNote ?? "—"}`,
      { color: GREY },
    );
  }
  L.text(risk.explanation);

  // E. Responsiveness review
  L.heading("E. Responsiveness Review");
  if (project.responsivenessReview) {
    if (project.responsivenessSuggested) {
      L.text("Suggested narrative — pending named-reviewer confirmation.", {
        font: fonts.italic,
        color: GREY,
      });
    }
    for (const block of String(project.responsivenessReview).split("\n\n")) {
      if (block.trim()) L.text(block.trim());
    }
  } else {
    L.text("No responsiveness review recorded.", { font: fonts.italic });
  }

  // F. BOQ verification annex
  L.heading("F. BOQ Verification Annex");
  if (boqChecks.length === 0) {
    L.text("No BOQ checks recorded.", { font: fonts.italic });
  } else {
    L.table(
      ["Line", "Check", "Finding", "Severity", "Status"],
      boqChecks.map((b) => [
        b.lineRef ?? "—",
        b.checkType,
        b.finding,
        b.severity,
        b.status,
      ]),
      [10, 18, 42, 15, 15],
    );
  }

  // G. Remediation plan
  L.heading("G. Remediation Plan");
  const remediable = confirmedDefects.filter((d) => d.status !== "waived");
  if (remediable.length === 0) {
    L.text("No outstanding remediation items.", { font: fonts.italic });
  } else {
    L.table(
      ["Defect", "Severity", "Owner", "Remediation", "Status"],
      remediable.map((d) => [
        d.description,
        d.severity,
        d.owner ?? "—",
        d.remediation ?? "—",
        d.status,
      ]),
      [30, 13, 15, 30, 12],
    );
  }

  // H. Copies manifest
  const CHECK = "[ ]";
  L.heading("H. Copies Manifest");
  L.text(
    "Confirm each required hard copy is produced, correctly labelled, bound, and sealed before dispatch. Mark the number of copies against the tender instructions to bidders (ITB).",
    { font: fonts.italic, color: GREY },
  );
  L.table(
    ["Copy", "Label on cover", "Bound", "Sealed", "Included"],
    [
      ["Original", "ORIGINAL", CHECK, CHECK, CHECK],
      ["Copy 1", "COPY", CHECK, CHECK, CHECK],
      ["Copy 2", "COPY", CHECK, CHECK, CHECK],
      ["Soft copy (if required)", "USB / CD — as ITB", CHECK, CHECK, CHECK],
    ],
    [26, 34, 13, 13, 14],
  );

  // I. Signature & seal checklist
  L.heading("I. Signature & Seal Checklist");
  L.text(
    "Every point below must be signed and, where indicated, stamped with the company seal by an authorised signatory before submission.",
    { font: fonts.italic, color: GREY },
  );
  L.table(
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
  );

  // J. Sign-off page
  L.heading("J. Sign-Off");
  L.text(
    "This report is a DRAFT until a named reviewer signs off below. Export is blocked until sign-off is recorded.",
    { font: fonts.italic },
  );
  L.gap(8);
  L.text("Reviewer name: ______________________________", {
    size: 11,
    after: 10,
  });
  L.text("Attestation: ________________________________", {
    size: 11,
    after: 10,
  });
  L.text("Date: _______________________________________", {
    size: 11,
    after: 10,
  });

  L.gap(12);
  L.text("Process Warranty", { font: fonts.bold, color: NAVY });
  L.text(PROCESS_WARRANTY, { font: fonts.italic });
  L.text(
    `Engine: ${ENGINE_VERSION} · Prompt pack: ${PROMPT_PACK_VERSION} · Model: ${MODEL_ID}`,
    {
      color: GREY,
    },
  );

  L.finalize();
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
