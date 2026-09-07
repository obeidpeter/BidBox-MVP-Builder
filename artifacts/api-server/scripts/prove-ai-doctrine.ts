/**
 * Doctrine proof harness for the BidBox Bid Autopsy Workbench.
 *
 * Proves, end-to-end, the three doctrine guarantees for the LLM-backed flows:
 *   1. Every AI suggestion cites a real source (document + page/clause) and
 *      never references a document/requirement outside the supplied set.
 *   2. Nothing is fabricated beyond the source text — "present" evidence
 *      excerpts are verbatim quotes that actually appear in the bid document,
 *      and a requirement with no supporting evidence is reported "missing"
 *      rather than invented.
 *   3. Suggested items require explicit reviewer confirmation before counting
 *      toward the disqualification risk score.
 *
 * The supported mode is --offline: a deterministic risk-gating proof with no
 * DB or provider call. The historical throwaway-project live path is retired;
 * production-quality evidence requires the controlled shadow/evaluation
 * runner. Offline mode is fast, side-effect free and safe for CI.
 */
import { computeRisk } from "../src/lib/deterministic";
import { createChecker } from "./lib/proofCheck";

const checker = createChecker();
const { check, section } = checker;

/** Normalise text for a robust verbatim-substring comparison. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`\u201c\u201d\u2018\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `excerpt` is genuinely drawn from `source` (verbatim, allowing for
 * an ellipsis that splits a longer quote into contiguous fragments).
 */
function excerptGroundedIn(excerpt: string, source: string): boolean {
  const src = norm(source);
  const fragments = excerpt
    .split(/\.{2,}|\u2026/)
    .map((f) => norm(f))
    .filter((f) => f.length >= 8);
  if (fragments.length === 0)
    return norm(excerpt).length > 0 && src.includes(norm(excerpt));
  return fragments.every((f) => src.includes(f));
}

// ---------------------------------------------------------------------------
// 1. Deterministic risk-gating proof (no DB, no OpenAI).
// ---------------------------------------------------------------------------
function proveRiskGating(): void {
  section("Doctrine proof #3: suggested items do not count toward risk");

  const reqId = "11111111-1111-1111-1111-111111111111";

  // All items present but every one still in the "suggested" (unconfirmed)
  // state: a fatal suggested defect and a missing evidence row on a suggested
  // mandatory requirement.
  const suggested = computeRisk({
    defects: [{ severity: "fatal", status: "suggested" }],
    requirements: [{ id: reqId, isMandatory: true, reviewStatus: "suggested" }],
    evidence: [
      { requirementId: reqId, evidenceStatus: "missing", suggested: true },
    ],
  });
  check(
    "unconfirmed suggestions score 0 / low band",
    suggested.score === 0 && suggested.band === "low",
    `got score=${suggested.score} band=${suggested.band}`,
  );

  // The very same findings, now confirmed by a named reviewer.
  const confirmed = computeRisk({
    defects: [{ severity: "fatal", status: "open" }],
    requirements: [{ id: reqId, isMandatory: true, reviewStatus: "confirmed" }],
    evidence: [
      { requirementId: reqId, evidenceStatus: "missing", suggested: false },
    ],
  });
  check(
    "confirmed findings score higher (fatal -> critical)",
    confirmed.score > suggested.score && confirmed.band === "critical",
    `got score=${confirmed.score} band=${confirmed.band}`,
  );

  // A confirmed requirement whose evidence row is still an AI suggestion must
  // not incur the missing-evidence penalty yet.
  const mixed = computeRisk({
    defects: [],
    requirements: [{ id: reqId, isMandatory: true, reviewStatus: "confirmed" }],
    evidence: [
      { requirementId: reqId, evidenceStatus: "missing", suggested: true },
    ],
  });
  check(
    "suggested evidence on a confirmed requirement adds no penalty",
    mixed.score === 0,
    `got score=${mixed.score}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Live end-to-end proof against real OpenAI.
// ---------------------------------------------------------------------------
const TENDER_TEXT = `VALO MUNICIPALITY \u2014 TENDER VMT-2026-014: SUPPLY AND DELIVERY OF WATER TREATMENT CHEMICALS

Page 2
Clause 3.1  Bidders MUST submit a valid original Tax Clearance Certificate (or SARS Tax Compliance Status PIN) confirming that the bidder's tax affairs are in order. Failure to submit will result in disqualification.

Page 3
Clause 4.2  Bidders MUST provide a valid B-BBEE Status Level Verification Certificate issued by a SANAS-accredited verification agency. This is a mandatory eligibility requirement.

Page 4
Clause 5.1  A bid security (bid bond) of ZAR 50,000.00 valid for 90 days MUST accompany the bid. Bids submitted without the required bid security shall be rejected as non-responsive.

Page 5
Clause 6.3  Bidders should provide at least three (3) contactable reference letters from previous clients of similar scope. This is desirable but not mandatory.`;

// The bid contains the Tax Clearance and the Bid Security verbatim, but
// deliberately OMITS any B-BBEE certificate, so a faithful model must report
// the B-BBEE requirement as "missing" and must NOT invent an excerpt for it.
const BID_TEXT = `BIDDER: AQUACHEM SUPPLIES (PTY) LTD \u2014 RESPONSE TO TENDER VMT-2026-014

Attachment A \u2014 Tax Compliance
The bidder's Tax Clearance Certificate confirms that AQUACHEM SUPPLIES (PTY) LTD tax affairs are in order and fully compliant as at 12 February 2026.

Attachment C \u2014 Bid Security
A Standard Bank guarantee for the amount of ZAR 50,000.00, valid for a period of 90 days from the bid closing date, is attached as the required bid security.

Attachment D \u2014 References
Reference letter 1: City of Riverside Water Board.
Reference letter 2: Northgate Industrial Estate.`;

async function proveLive(): Promise<void> {
  section("Live end-to-end proof against real OpenAI");
  // Imported lazily so the OFFLINE mode needs neither DATABASE_URL nor the
  // OpenAI integration env vars — that keeps the offline proof runnable in CI.
  const { eq } = await import("drizzle-orm");
  const {
    assertRuntimeDatabaseSecurity,
    isProductionRuntime,
    db,
    clients,
    projects,
    documents,
    requirements: requirementsTable,
    evidenceItems,
    defects: defectsTable,
  } = await import("@workspace/db");
  if (isProductionRuntime(process.env)) {
    throw new Error("the live doctrine proof is forbidden in production");
  }
  await assertRuntimeDatabaseSecurity();
  const { extractRequirements, mapEvidence, suggestDefects } =
    await import("../src/lib/llm");
  const stamp = new Date().toISOString();
  let clientId: string | null = null;

  try {
    const [client] = await db
      .insert(clients)
      .values({ name: `__DOCTRINE_PROOF__ ${stamp}` })
      .returning();
    clientId = client.id;
    const [project] = await db
      .insert(projects)
      .values({
        clientId: client.id,
        tenderTitle: "Doctrine Proof VMT-2026-014",
        status: "intake",
      })
      .returning();
    const [tenderDoc] = await db
      .insert(documents)
      .values({
        projectId: project.id,
        type: "tender",
        filename: "tender.txt",
        objectPath: "proof/tender.txt",
        redactionStatus: "included",
        contentText: TENDER_TEXT,
      })
      .returning();
    const [bidDoc] = await db
      .insert(documents)
      .values({
        projectId: project.id,
        type: "bid",
        filename: "bid.txt",
        objectPath: "proof/bid.txt",
        redactionStatus: "included",
        contentText: BID_TEXT,
      })
      .returning();

    const validDocIds = new Set([tenderDoc.id, bidDoc.id]);

    // --- Flow 1: extract requirements from the tender -----------------------
    section("Doctrine proof #1: requirement suggestions cite a real source");
    const { requirements: extracted } = await extractRequirements(project.id, [
      {
        id: tenderDoc.id,
        filename: tenderDoc.filename,
        type: tenderDoc.type,
        contentText: tenderDoc.contentText,
      },
    ]);
    check(
      "model returned >= 3 requirements",
      extracted.length >= 3,
      `got ${extracted.length}`,
    );
    const noFabricatedDoc = extracted.every(
      (r) => !r.sourceDocId || r.sourceDocId === tenderDoc.id,
    );
    check("no requirement cites a fabricated document id", noFabricatedDoc);
    const allCited = extracted.every((r) => !!(r.pageRef || r.clauseRef));
    check(
      "every requirement carries a page/clause citation",
      allCited,
      allCited
        ? undefined
        : `uncited: ${extracted
            .filter((r) => !(r.pageRef || r.clauseRef))
            .map((r) => r.text.slice(0, 40))
            .join(" | ")}`,
    );

    // Persist as the route does (suggested), then confirm as a reviewer would.
    const insertedReqs = await db
      .insert(requirementsTable)
      .values(
        extracted.map((r) => ({
          projectId: project.id,
          sourceDocId:
            r.sourceDocId && validDocIds.has(r.sourceDocId)
              ? r.sourceDocId
              : null,
          pageRef: r.pageRef ?? null,
          clauseRef: r.clauseRef ?? null,
          text: r.text,
          category: r.category ?? "other",
          expectedEvidence: r.expectedEvidence ?? null,
          isMandatory: r.isMandatory ?? true,
          confidence: r.confidence ?? null,
          reviewStatus: "suggested" as const,
        })),
      )
      .returning();
    check(
      "requirements persist in 'suggested' state",
      insertedReqs.every((r) => r.reviewStatus === "suggested"),
    );

    const bbeeReq = insertedReqs.find((r) => /b-?bbee/i.test(r.text));
    check("a B-BBEE mandatory requirement was extracted", !!bbeeReq);

    // Reviewer confirms the requirements (explicit human step).
    await db
      .update(requirementsTable)
      .set({ reviewStatus: "confirmed" })
      .where(eq(requirementsTable.projectId, project.id));
    const confirmedReqs = insertedReqs.map((r) => ({
      ...r,
      reviewStatus: "confirmed",
    }));

    // --- Flow 2: map evidence from the bid ----------------------------------
    section(
      "Doctrine proof #2: evidence excerpts are verbatim, missing != invented",
    );
    const { items } = await mapEvidence(
      project.id,
      confirmedReqs.map((r) => ({
        id: r.id,
        text: r.text,
        expectedEvidence: r.expectedEvidence,
      })),
      [
        {
          id: bidDoc.id,
          filename: bidDoc.filename,
          type: bidDoc.type,
          contentText: bidDoc.contentText,
        },
      ],
    );
    const reqIds = new Set(confirmedReqs.map((r) => r.id));
    check(
      "every evidence item maps to a real requirement",
      items.every((i) => reqIds.has(i.requirementId)),
    );
    check(
      "no evidence item cites a fabricated document id",
      items.every((i) => !i.documentId || i.documentId === bidDoc.id),
    );

    const presentItems = items.filter((i) => i.evidenceStatus === "present");
    const groundedExcerpts = presentItems.every(
      (i) => !!i.excerpt && excerptGroundedIn(i.excerpt, BID_TEXT),
    );
    check(
      "every 'present' excerpt is a verbatim quote from the bid",
      presentItems.length > 0 && groundedExcerpts,
      groundedExcerpts
        ? undefined
        : `ungrounded: ${presentItems
            .filter(
              (i) => !i.excerpt || !excerptGroundedIn(i.excerpt, BID_TEXT),
            )
            .map((i) => JSON.stringify(i.excerpt))
            .join(" | ")}`,
    );

    if (bbeeReq) {
      const bbeeEvidence = items.find((i) => i.requirementId === bbeeReq.id);
      const notPresent =
        !bbeeEvidence || bbeeEvidence.evidenceStatus !== "present";
      check(
        "absent B-BBEE evidence is not reported 'present'",
        notPresent,
        bbeeEvidence ? `status=${bbeeEvidence.evidenceStatus}` : "no row",
      );
      const noInventedExcerpt =
        !bbeeEvidence ||
        !bbeeEvidence.excerpt ||
        excerptGroundedIn(bbeeEvidence.excerpt, BID_TEXT);
      check(
        "no fabricated excerpt for the absent B-BBEE certificate",
        noInventedExcerpt,
      );
    }

    // Persist evidence as the route does (suggested).
    const insertedEv = await db
      .insert(evidenceItems)
      .values(
        items.map((i) => ({
          projectId: project.id,
          requirementId: i.requirementId,
          documentId:
            i.documentId && i.documentId === bidDoc.id ? i.documentId : null,
          evidenceStatus: i.evidenceStatus ?? "pending",
          excerpt: i.excerpt ?? null,
          notes: i.notes ?? null,
          suggested: true,
        })),
      )
      .returning();
    check(
      "evidence persists in suggested state",
      insertedEv.every((e) => e.suggested === true),
    );

    // --- Flow 3: suggest defects --------------------------------------------
    section(
      "Doctrine proof: defect suggestions are grounded and stay suggested",
    );
    const { defects: suggestedDefects } = await suggestDefects(
      project.id,
      confirmedReqs.map((r) => ({
        id: r.id,
        text: r.text,
        isMandatory: r.isMandatory,
      })),
      insertedEv.map((e) => ({
        requirementId: e.requirementId,
        evidenceStatus: e.evidenceStatus,
        notes: e.notes,
      })),
    );
    check(
      "at least one defect suggested",
      suggestedDefects.length > 0,
      `got ${suggestedDefects.length}`,
    );
    check(
      "no defect references a fabricated requirement id",
      suggestedDefects.every(
        (d) => !d.requirementId || reqIds.has(d.requirementId),
      ),
    );
    const insertedDefects = await db
      .insert(defectsTable)
      .values(
        suggestedDefects.map((d) => ({
          projectId: project.id,
          requirementId:
            d.requirementId && reqIds.has(d.requirementId)
              ? d.requirementId
              : null,
          type: d.type,
          severity: d.severity,
          description: d.description,
          remediation: d.remediation ?? null,
          status: "suggested" as const,
          suggested: true,
        })),
      )
      .returning();
    check(
      "defects persist in 'suggested' state",
      insertedDefects.every((d) => d.status === "suggested"),
    );

    // --- End-to-end risk gating on the real seeded data ---------------------
    section(
      "Doctrine proof #3 (live): suggested findings do not move the score",
    );
    const reqsForRisk = confirmedReqs.map((r) => ({
      id: r.id,
      isMandatory: r.isMandatory,
      reviewStatus: "confirmed",
    }));
    const riskWhileSuggested = computeRisk({
      defects: insertedDefects.map((d) => ({
        severity: d.severity as any,
        status: d.status,
      })),
      requirements: reqsForRisk,
      evidence: insertedEv.map((e) => ({
        requirementId: e.requirementId,
        evidenceStatus: e.evidenceStatus,
        suggested: e.suggested,
      })),
    });
    check(
      "risk score is 0 while all findings are suggested",
      riskWhileSuggested.score === 0,
      `got score=${riskWhileSuggested.score} band=${riskWhileSuggested.band}`,
    );

    const riskAfterConfirm = computeRisk({
      defects: insertedDefects.map((d) => ({
        severity: d.severity as any,
        status: "open",
      })),
      requirements: reqsForRisk,
      evidence: insertedEv.map((e) => ({
        requirementId: e.requirementId,
        evidenceStatus: e.evidenceStatus,
        suggested: false,
      })),
    });
    check(
      "risk score rises once findings are confirmed",
      riskAfterConfirm.score > riskWhileSuggested.score,
      `suggested=${riskWhileSuggested.score} confirmed=${riskAfterConfirm.score}`,
    );
  } finally {
    if (clientId) {
      await db.delete(clients).where(eq(clients.id, clientId));
      console.log("\n(cleaned up throwaway proof data)");
    }
  }
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  if (!offline) {
    throw new Error(
      "The legacy live doctrine path is retired. Use --offline; provider-backed production evidence requires the controlled shadow/evaluation runner.",
    );
  }
  console.log(
    offline
      ? "Running OFFLINE doctrine proof only.\n"
      : "Running FULL doctrine proof (offline + live OpenAI).\n",
  );

  proveRiskGating();
  if (!offline) {
    await proveLive();
  }

  console.log(`\n---------------------------------------------`);
  console.log(
    `RESULT: ${checker.passes()} passed, ${checker.failures()} failed`,
  );
  if (checker.failures() > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nPROOF HARNESS ERROR:", err);
    process.exit(1);
  });
