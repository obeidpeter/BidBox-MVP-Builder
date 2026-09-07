import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  organisations,
  clients,
  projects,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  vaultItems,
  eq,
  isProductionRuntime,
  withTenantDatabase,
} from "@workspace/db";

type SeedPackage = {
  client: {
    name: string;
    sector: string;
    segment: string;
    contactName: string;
    contactEmail: string;
    ndaStatus: string;
  };
  project: {
    tenderTitle: string;
    issuingEntity: string;
    tenderRef: string;
    deadline: string;
    valueBand: string;
    segment: string;
    submissionStatus: string;
    status: string;
    riskScore: number;
    riskBand: string;
  };
  requirements: {
    clauseRef: string;
    text: string;
    category: string;
    expectedEvidence: string;
    isMandatory: boolean;
  }[];
  defects: {
    type: string;
    severity: string;
    description: string;
    remediation: string;
  }[];
  boq: {
    lineRef: string;
    description: string;
    quantity: number;
    unitRate: number;
    extension: number;
    computedExtension: number;
    checkType: string;
    finding: string;
    severity: string;
    status: string;
  }[];
  vault: {
    artefactType: string;
    issuer: string;
    issueDate: string;
    expiryDate: string;
    status: string;
  }[];
};

const packages: SeedPackage[] = [
  {
    client: {
      name: "Al Noor Contracting LLC",
      sector: "Construction",
      segment: "Civil Works",
      contactName: "Fatima Rashid",
      contactEmail: "f.rashid@alnoor.example",
      ndaStatus: "signed",
    },
    project: {
      tenderTitle: "Municipal Road Rehabilitation — Phase II",
      issuingEntity: "City Municipality",
      tenderRef: "MUN-2026-0142",
      deadline: "2026-08-15",
      valueBand: "10M-25M",
      segment: "Civil Works",
      submissionStatus: "received",
      status: "review",
      riskScore: 72,
      riskBand: "critical",
    },
    requirements: [
      {
        clauseRef: "3.1",
        text: "Bidder must hold a valid Grade A contractor classification.",
        category: "eligibility",
        expectedEvidence: "Contractor classification certificate",
        isMandatory: true,
      },
      {
        clauseRef: "4.2",
        text: "Priced Bill of Quantities must be submitted with no arithmetic errors.",
        category: "commercial",
        expectedEvidence: "Priced BOQ",
        isMandatory: true,
      },
      {
        clauseRef: "5.4",
        text: "Bid bond of 2% of tender value valid for 120 days.",
        category: "financial",
        expectedEvidence: "Bid bond guarantee",
        isMandatory: true,
      },
    ],
    defects: [
      {
        type: "arithmetic_error",
        severity: "fatal",
        description: "BOQ grand total does not match sum of line extensions.",
        remediation:
          "Re-verify all line extensions and correct the grand total.",
      },
      {
        type: "missing_evidence",
        severity: "likely_fatal",
        description: "No valid bid bond attached to the submission.",
        remediation: "Obtain and attach a compliant bid bond before deadline.",
      },
    ],
    boq: [
      {
        lineRef: "1.01",
        description: "Site clearance and grubbing",
        quantity: 12000,
        unitRate: 3.5,
        extension: 42000,
        computedExtension: 42000,
        checkType: "extension_mismatch",
        finding: "Extension matches quantity x rate.",
        severity: "cosmetic",
        status: "ok",
      },
      {
        lineRef: "2.03",
        description: "Asphalt base course 60mm",
        quantity: 8500,
        unitRate: 18.0,
        extension: 150000,
        computedExtension: 153000,
        checkType: "extension_mismatch",
        finding: "Extension differs from quantity x rate by 3,000.",
        severity: "fatal",
        status: "flagged",
      },
    ],
    vault: [
      {
        artefactType: "Contractor Classification",
        issuer: "Ministry of Works",
        issueDate: "2024-01-10",
        expiryDate: "2026-01-10",
        status: "expired",
      },
    ],
  },
  {
    client: {
      name: "Gulf Facilities Management",
      sector: "Facilities",
      segment: "Maintenance",
      contactName: "Omar Haddad",
      contactEmail: "omar.h@gulffm.example",
      ndaStatus: "signed",
    },
    project: {
      tenderTitle: "Integrated FM Services — Government Complex",
      issuingEntity: "General Services Authority",
      tenderRef: "GSA-2026-0311",
      deadline: "2026-09-01",
      valueBand: "5M-10M",
      segment: "Maintenance",
      submissionStatus: "received",
      status: "review",
      riskScore: 45,
      riskBand: "high",
    },
    requirements: [
      {
        clauseRef: "2.1",
        text: "Minimum three comparable FM contracts in the last five years.",
        category: "experience",
        expectedEvidence: "Reference letters",
        isMandatory: true,
      },
      {
        clauseRef: "6.3",
        text: "ISO 9001 and ISO 45001 certifications required.",
        category: "quality",
        expectedEvidence: "ISO certificates",
        isMandatory: true,
      },
    ],
    defects: [
      {
        type: "expired_evidence",
        severity: "scoring_risk",
        description: "ISO 45001 certificate expired two months ago.",
        remediation: "Provide renewed ISO 45001 certificate.",
      },
    ],
    boq: [
      {
        lineRef: "1.00",
        description: "Annual preventive maintenance",
        quantity: 1,
        unitRate: 480000,
        extension: 480000,
        computedExtension: 480000,
        checkType: "extension_mismatch",
        finding: "Extension matches.",
        severity: "cosmetic",
        status: "ok",
      },
    ],
    vault: [
      {
        artefactType: "ISO 45001",
        issuer: "TUV",
        issueDate: "2023-04-01",
        expiryDate: "2026-05-01",
        status: "expired",
      },
      {
        artefactType: "ISO 9001",
        issuer: "TUV",
        issueDate: "2024-06-01",
        expiryDate: "2027-06-01",
        status: "active",
      },
    ],
  },
  {
    client: {
      name: "Emirates Steel Structures",
      sector: "Manufacturing",
      segment: "Steel Fabrication",
      contactName: "Layla Mansour",
      contactEmail: "layla@essteel.example",
      ndaStatus: "signed",
    },
    project: {
      tenderTitle: "Structural Steel Supply — Airport Terminal",
      issuingEntity: "Airports Company",
      tenderRef: "AC-2026-0087",
      deadline: "2026-07-30",
      valueBand: "25M-50M",
      segment: "Steel Fabrication",
      submissionStatus: "received",
      status: "review",
      riskScore: 18,
      riskBand: "medium",
    },
    requirements: [
      {
        clauseRef: "4.1",
        text: "Mill test certificates for all supplied steel grades.",
        category: "technical",
        expectedEvidence: "Mill certificates",
        isMandatory: true,
      },
    ],
    defects: [
      {
        type: "cosmetic",
        severity: "cosmetic",
        description: "Cover letter missing company stamp.",
        remediation: "Re-issue cover letter with company stamp.",
      },
    ],
    boq: [
      {
        lineRef: "1.01",
        description: "Structural steel sections S355",
        quantity: 1200,
        unitRate: 950,
        extension: 1140000,
        computedExtension: 1140000,
        checkType: "extension_mismatch",
        finding: "Extension matches.",
        severity: "cosmetic",
        status: "ok",
      },
    ],
    vault: [
      {
        artefactType: "Mill Certificate",
        issuer: "Emirates Steel",
        issueDate: "2025-11-01",
        expiryDate: "2027-11-01",
        status: "active",
      },
    ],
  },
  {
    client: {
      name: "Sahara MEP Solutions",
      sector: "MEP",
      segment: "Electromechanical",
      contactName: "Yusuf Karim",
      contactEmail: "yusuf@saharamep.example",
      ndaStatus: "pending",
    },
    project: {
      tenderTitle: "HVAC & Electrical Fit-out — Hospital Wing",
      issuingEntity: "Health Ministry",
      tenderRef: "HM-2026-0205",
      deadline: "2026-08-20",
      valueBand: "10M-25M",
      segment: "Electromechanical",
      submissionStatus: "received",
      status: "intake",
      riskScore: 8,
      riskBand: "low",
    },
    requirements: [
      {
        clauseRef: "3.2",
        text: "Licensed MEP engineers on staff (minimum two).",
        category: "personnel",
        expectedEvidence: "Engineer licenses",
        isMandatory: true,
      },
    ],
    defects: [],
    boq: [
      {
        lineRef: "1.01",
        description: "Chilled water AHU units",
        quantity: 24,
        unitRate: 32000,
        extension: 768000,
        computedExtension: 768000,
        checkType: "extension_mismatch",
        finding: "Extension matches.",
        severity: "cosmetic",
        status: "ok",
      },
    ],
    vault: [
      {
        artefactType: "Trade License",
        issuer: "Economic Department",
        issueDate: "2025-01-01",
        expiryDate: "2026-12-31",
        status: "active",
      },
    ],
  },
  {
    client: {
      name: "Peninsula Infrastructure Co",
      sector: "Infrastructure",
      segment: "Utilities",
      contactName: "Nadia Sultan",
      contactEmail: "nadia@peninsula.example",
      ndaStatus: "signed",
    },
    project: {
      tenderTitle: "Water Network Extension — District 9",
      issuingEntity: "Water Authority",
      tenderRef: "WA-2026-0159",
      deadline: "2026-09-10",
      valueBand: "5M-10M",
      segment: "Utilities",
      submissionStatus: "received",
      status: "review",
      riskScore: 52,
      riskBand: "high",
    },
    requirements: [
      {
        clauseRef: "5.1",
        text: "Performance guarantee of 10% of contract value.",
        category: "financial",
        expectedEvidence: "Performance bond",
        isMandatory: true,
      },
      {
        clauseRef: "2.4",
        text: "Health and safety plan specific to trenching works.",
        category: "safety",
        expectedEvidence: "HSE plan",
        isMandatory: true,
      },
    ],
    defects: [
      {
        type: "missing_evidence",
        severity: "likely_fatal",
        description: "HSE plan for trenching works not included.",
        remediation: "Prepare and submit a trenching-specific HSE plan.",
      },
    ],
    boq: [
      {
        lineRef: "1.02",
        description: "DI pipe supply and lay DN300",
        quantity: 3400,
        unitRate: 145,
        extension: 493000,
        computedExtension: 493000,
        checkType: "extension_mismatch",
        finding: "Extension matches.",
        severity: "cosmetic",
        status: "ok",
      },
      {
        lineRef: "3.01",
        description: "Excavation in rock",
        quantity: 0,
        unitRate: 85,
        extension: 0,
        computedExtension: 0,
        checkType: "suspicious_zero",
        finding: "Zero quantity for a typically required item.",
        severity: "scoring_risk",
        status: "flagged",
      },
    ],
    vault: [
      {
        artefactType: "Performance Bond Facility",
        issuer: "National Bank",
        issueDate: "2025-06-01",
        expiryDate: "2026-06-01",
        status: "expired",
      },
    ],
  },
];

async function seed() {
  if (isProductionRuntime(process.env)) {
    throw new Error("sample-data seeding is forbidden in production");
  }
  console.log("Seeding BidBox Bid Autopsy Workbench sample data...");

  const [existingSeedOrganisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "valo-sample-workspace"));
  const seedOrganisationId = existingSeedOrganisation?.id ?? randomUUID();
  const [seedOrganisation] = await withTenantDatabase(seedOrganisationId, () =>
    db
      .insert(organisations)
      .values({
        id: seedOrganisationId,
        name: "BidBox Sample Workspace",
        slug: "valo-sample-workspace",
        type: "valo",
      })
      .onConflictDoUpdate({
        target: organisations.slug,
        set: {
          name: "BidBox Sample Workspace",
          status: "active",
          updatedAt: new Date(),
        },
      })
      .returning(),
  );

  // A seed run may replace only its own tenant. It must never erase another
  // organisation's production or evaluation data.
  await withTenantDatabase(seedOrganisation.id, async () => {
    await db
      .delete(boqChecks)
      .where(eq(boqChecks.organisationId, seedOrganisation.id));
    await db
      .delete(defects)
      .where(eq(defects.organisationId, seedOrganisation.id));
    await db
      .delete(evidenceItems)
      .where(eq(evidenceItems.organisationId, seedOrganisation.id));
    await db
      .delete(requirements)
      .where(eq(requirements.organisationId, seedOrganisation.id));
    await db
      .delete(projects)
      .where(eq(projects.organisationId, seedOrganisation.id));
    await db
      .delete(vaultItems)
      .where(eq(vaultItems.organisationId, seedOrganisation.id));
    await db
      .delete(clients)
      .where(eq(clients.organisationId, seedOrganisation.id));

    for (const pkg of packages) {
      const [client] = await db
        .insert(clients)
        .values({ ...pkg.client, organisationId: seedOrganisation.id })
        .returning();

      const [project] = await db
        .insert(projects)
        .values({
          ...pkg.project,
          organisationId: seedOrganisation.id,
          clientId: client.id,
        })
        .returning();

      if (pkg.vault.length) {
        await db.insert(vaultItems).values(
          pkg.vault.map((v) => ({
            ...v,
            organisationId: seedOrganisation.id,
            clientId: client.id,
          })),
        );
      }

      const insertedReqs = pkg.requirements.length
        ? await db
            .insert(requirements)
            .values(
              pkg.requirements.map((r) => ({
                ...r,
                organisationId: seedOrganisation.id,
                projectId: project.id,
                reviewStatus: "confirmed",
              })),
            )
            .returning()
        : [];

      if (insertedReqs.length) {
        await db.insert(evidenceItems).values(
          insertedReqs.map((r, i) => ({
            organisationId: seedOrganisation.id,
            projectId: project.id,
            requirementId: r.id,
            evidenceStatus: i === 0 ? "confirmed" : "pending",
            excerpt: i === 0 ? "Evidence located in submitted document." : null,
            suggested: i !== 0,
          })),
        );
      }

      if (pkg.defects.length) {
        await db.insert(defects).values(
          pkg.defects.map((d) => ({
            ...d,
            organisationId: seedOrganisation.id,
            projectId: project.id,
            suggested: false,
          })),
        );
      }

      if (pkg.boq.length) {
        await db.insert(boqChecks).values(
          pkg.boq.map((b) => ({
            ...b,
            organisationId: seedOrganisation.id,
            projectId: project.id,
          })),
        );
      }

      // Deliberately NO audit_events mutation here: raw inserts would create
      // unchained rows and audit history is append-only. A brand-new sample
      // tenant therefore starts a clean chain when its first real writeAudit
      // occurs; an existing sample tenant retains its prior history.
      console.log(`  ✓ ${pkg.client.name} — ${pkg.project.tenderTitle}`);
    }
  });

  console.log(`Done. Seeded ${packages.length} packages.`);
  await pool.end();
}

seed().catch(async (err) => {
  console.error("Seed failed:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
