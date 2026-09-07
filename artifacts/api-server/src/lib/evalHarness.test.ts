import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  requirementMatched,
  computeTenderRecall,
  aggregateReport,
  validateCorpus,
  validateCorpusManifest,
  evaluateReportAgainstProfile,
  EVAL_RECALL_TARGET_V0,
  GATE0_NON_PRODUCTION_PROFILE,
  PRODUCTION_EVAL_PROFILE,
  REQUIRED_PRODUCTION_COHORTS,
  type EvalTender,
  type EvalCorpusManifest,
  type EvalModelOutput,
  type GroundTruthRequirement,
} from "./evalHarness";

const gt = (over: Partial<GroundTruthRequirement>): GroundTruthRequirement => ({
  id: "g1",
  label: "Tax clearance certificate",
  mandatory: true,
  match: [
    ["tax clearance", "tax compliance", "sars"],
    ["certificate", "pin", "status"],
  ],
  ...over,
});

const tender = (over: Partial<EvalTender>): EvalTender => ({
  id: "t1",
  title: "Test tender",
  documentText: "Some tender text.",
  groundTruth: [gt({})],
  ...over,
});

describe("normalizeText", () => {
  test("lowercases, strips punctuation, collapses whitespace", () => {
    assert.equal(
      normalizeText("  Tax-Clearance   CERTIFICATE!! "),
      "tax clearance certificate",
    );
  });
});

describe("requirementMatched - AND-of-ORs", () => {
  test("recalled when one extracted text satisfies every group", () => {
    const norm = ["Bidders must submit a valid Tax Clearance Certificate."].map(
      normalizeText,
    );
    assert.equal(requirementMatched(gt({}), norm), true);
  });

  test("alternative in a group is enough", () => {
    const norm = ["A valid SARS PIN is required."].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), true);
  });

  test("not recalled when a group has no satisfying alternative", () => {
    // Has the certificate group but nothing from the tax group.
    const norm = ["Submit a B-BBEE certificate."].map(normalizeText);
    assert.equal(requirementMatched(gt({}), norm), false);
  });

  test("groups must be satisfied within a SINGLE extracted text, not spread", () => {
    // "tax clearance" in one row, "certificate" in another — must NOT count.
    const norm = ["tax clearance is needed", "attach the certificate"].map(
      normalizeText,
    );
    assert.equal(requirementMatched(gt({}), norm), false);
  });

  test("empty match spec never matches", () => {
    assert.equal(
      requirementMatched(gt({ match: [] }), ["anything"].map(normalizeText)),
      false,
    );
  });
});

describe("computeTenderRecall", () => {
  test("counts matched and lists the missed ground-truth rows", () => {
    const t = tender({
      groundTruth: [
        gt({ id: "g1" }),
        gt({
          id: "g2",
          label: "Bid security",
          match: [
            ["bid security", "bid bond"],
            ["required", "must", "shall"],
          ],
        }),
      ],
    });
    const r = computeTenderRecall(t, [
      "Provide a valid Tax Clearance Certificate.",
    ]);
    assert.equal(r.total, 2);
    assert.equal(r.matched, 1);
    assert.equal(r.recall, 0.5);
    assert.deepEqual(
      r.missed.map((m) => m.id),
      ["g2"],
    );
  });

  test("empty ground truth yields recall 1", () => {
    const r = computeTenderRecall(tender({ groundTruth: [] }), []);
    assert.equal(r.recall, 1);
  });
});

describe("aggregateReport", () => {
  test("aggregates across tenders and applies the target", () => {
    const perTender = [
      computeTenderRecall(tender({ id: "t1" }), [
        "Tax Clearance Certificate attached.",
      ]),
      computeTenderRecall(
        tender({
          id: "t2",
          groundTruth: [
            gt({ id: "g1" }),
            gt({
              id: "g2",
              label: "Bid security",
              match: [["bid security", "bid bond"]],
            }),
          ],
        }),
        ["Tax Clearance Certificate attached."],
      ),
    ];
    const report = aggregateReport(perTender, 0.85);
    assert.equal(report.totalGroundTruth, 3);
    assert.equal(report.totalMatched, 2);
    assert.ok(Math.abs(report.overallRecall - 2 / 3) < 1e-9);
    assert.equal(report.passed, false);
  });

  test("passes at exactly the target boundary", () => {
    const perTender = [
      computeTenderRecall(tender({}), ["Tax Clearance Certificate."]),
    ];
    const report = aggregateReport(perTender, 1);
    assert.equal(report.overallRecall, 1);
    assert.equal(report.passed, true);
  });

  test("default target is the v0 bar", () => {
    const report = aggregateReport([]);
    assert.equal(report.target, EVAL_RECALL_TARGET_V0);
  });

  test("a degraded extraction drops below the v0 target and fails (no silent pass)", () => {
    // Simulate a prompt/model regression: across a 10-tender corpus the engine
    // now surfaces only the tax-clearance obligation and drops the bid-security
    // one — i.e. 1 of 2 mandatory requirements per tender. Overall recall = 50%,
    // well under the 85% v0 bar, so the report MUST report failure.
    const degradedExtraction = ["Tax Clearance Certificate attached."];
    const perTender = Array.from({ length: 10 }, (_, i) =>
      computeTenderRecall(
        tender({
          id: `t${i}`,
          groundTruth: [
            gt({ id: "g1" }),
            gt({
              id: "g2",
              label: "Bid security",
              mandatory: true,
              match: [["bid security", "bid bond"]],
            }),
          ],
        }),
        degradedExtraction,
      ),
    );
    const report = aggregateReport(perTender, EVAL_RECALL_TARGET_V0);
    assert.equal(report.overallRecall, 0.5);
    assert.equal(report.passed, false);
    // Every tender must name the dropped requirement so the failure is actionable.
    assert.ok(
      report.perTender.every((t) => t.missed.some((m) => m.id === "g2")),
    );
  });
});

describe("validateCorpus", () => {
  test("flags a corpus below the minimum size", () => {
    const problems = validateCorpus([tender({})]);
    assert.ok(problems.some((p) => p.includes("need >=")));
  });

  test("flags duplicate ids, empty specs, and missing mandatory rows", () => {
    const bad: EvalTender[] = [
      tender({ id: "dup", groundTruth: [gt({ mandatory: false })] }),
      tender({ id: "dup", groundTruth: [gt({ id: "x", match: [] })] }),
    ];
    const problems = validateCorpus(bad);
    assert.ok(problems.some((p) => p.includes("duplicate tender id")));
    assert.ok(problems.some((p) => p.includes("no mandatory")));
    assert.ok(problems.some((p) => p.includes("empty match spec")));
  });

  test("a well-formed minimal corpus of >= 10 tenders has no problems", () => {
    const corpus = Array.from({ length: 10 }, (_, i) =>
      tender({ id: `t${i}` }),
    );
    assert.deepEqual(validateCorpus(corpus), []);
  });
});

describe("mandatory recall (FR-EXT-05 gate figure)", () => {
  test("mandatory recall counts only mandatory rows; desirable misses do not gate", () => {
    const t = tender({
      groundTruth: [
        gt({
          id: "g1",
          label: "Tax clearance",
          mandatory: true,
          match: [["tax clearance"]],
        }),
        gt({
          id: "g2",
          label: "Brochures",
          mandatory: false,
          match: [["brochure"]],
        }),
      ],
    });
    // Engine surfaces the mandatory row but not the desirable one.
    const result = computeTenderRecall(t, [
      "Submit a valid tax clearance certificate",
    ]);
    assert.equal(result.mandatoryTotal, 1);
    assert.equal(result.mandatoryMatched, 1);
    assert.equal(result.mandatoryRecall, 1);
    assert.ok(Math.abs(result.recall - 0.5) < 1e-9);

    const report = aggregateReport([result]);
    assert.equal(report.mandatoryPassed, true);
    assert.equal(report.passed, false); // overall 50% < 85% target
  });

  test("a missed mandatory row fails the mandatory gate", () => {
    const t = tender({
      groundTruth: [
        gt({
          id: "g1",
          label: "Bid security",
          mandatory: true,
          match: [["bid security", "bid bond"]],
        }),
      ],
    });
    const report = aggregateReport([
      computeTenderRecall(t, ["Unrelated text"]),
    ]);
    assert.equal(report.mandatoryRecall, 0);
    assert.equal(report.mandatoryPassed, false);
  });
});

describe("production evaluation metrics", () => {
  const fatalTender = tender({
    groundTruth: [
      gt({
        id: "fatal-bid-security",
        label: "Bid security",
        severity: "fatal",
        match: [["bid security"]],
      }),
    ],
  });

  test("scores one-to-one precision, citations, unsupported claims and fatal misses", () => {
    const output: EvalModelOutput = {
      disposition: "completed",
      requirements: [
        {
          text: "Bid security is mandatory",
          citationVerdict: "correct",
          unsupportedClaim: false,
        },
        {
          text: "Unrelated invented obligation",
          citationVerdict: "missing",
          unsupportedClaim: true,
        },
      ],
    };
    const report = aggregateReport([computeTenderRecall(fatalTender, output)]);
    assert.equal(report.overallRecall, 1);
    assert.equal(report.mandatoryRecall, 1);
    assert.equal(report.fatalMisses, 0);
    assert.equal(report.precision, 0.5);
    assert.equal(report.citationCoverage, 1);
    assert.equal(report.citationCorrectness, 0.5);
    assert.equal(report.supportEvaluationCoverage, 1);
    assert.equal(report.unsupportedClaimRate, 0.5);
  });

  test("duplicate candidates do not inflate matched candidate precision", () => {
    const report = aggregateReport([
      computeTenderRecall(fatalTender, {
        disposition: "completed",
        requirements: [
          {
            text: "Bid security",
            citationVerdict: "correct",
            unsupportedClaim: false,
          },
          {
            text: "Bid security",
            citationVerdict: "correct",
            unsupportedClaim: false,
          },
        ],
      }),
    ]);
    assert.equal(report.totalMatched, 1);
    assert.equal(report.matchedCandidates, 1);
    assert.equal(report.precision, 0.5);
  });

  test("scores abstention and safe-failure negative cases independently", () => {
    const abstention = tender({
      id: "negative-abstain",
      expectedBehaviour: "abstain",
      groundTruth: [],
    });
    const safeFailure = tender({
      id: "negative-failure",
      expectedBehaviour: "safe_failure",
      groundTruth: [],
    });
    const report = aggregateReport([
      computeTenderRecall(abstention, {
        disposition: "abstained",
        requirements: [],
      }),
      computeTenderRecall(safeFailure, {
        disposition: "safe_failure",
        requirements: [],
      }),
    ]);
    assert.equal(report.abstentionAccuracy, 1);
    assert.equal(report.safeFailureRate, 1);
  });

  test("production profile enforces the release thresholds and metric coverage", () => {
    const weak = aggregateReport([
      computeTenderRecall(fatalTender, {
        disposition: "completed",
        requirements: [
          {
            text: "Bid security",
            citationVerdict: "unverified",
          },
        ],
      }),
    ]);
    const production = evaluateReportAgainstProfile(
      weak,
      PRODUCTION_EVAL_PROFILE,
    );
    assert.equal(production.passed, false);
    assert.ok(
      production.failures.some(
        (failure) => failure.metric === "citation_correctness",
      ),
    );
    assert.ok(
      production.failures.some(
        (failure) => failure.metric === "support_evaluation_coverage",
      ),
    );
    assert.ok(
      production.failures.some(
        (failure) => failure.metric === "abstention_accuracy",
      ),
    );

    const gate0 = evaluateReportAgainstProfile(
      weak,
      GATE0_NON_PRODUCTION_PROFILE,
    );
    assert.equal(gate0.production, false);
    assert.equal(gate0.passed, true);
  });

  test("production profile blocks every seeded fatal miss", () => {
    const report = aggregateReport([
      computeTenderRecall(fatalTender, {
        disposition: "completed",
        requirements: [
          {
            text: "Tax clearance only",
            citationVerdict: "correct",
            unsupportedClaim: false,
          },
        ],
      }),
    ]);
    const result = evaluateReportAgainstProfile(
      report,
      PRODUCTION_EVAL_PROFILE,
    );
    assert.ok(
      result.failures.some((failure) => failure.metric === "fatal_misses"),
    );
  });

  test("fails closed on non-finite or out-of-range recorded metrics", () => {
    const report = aggregateReport([
      computeTenderRecall(fatalTender, {
        disposition: "completed",
        requirements: [
          {
            text: "Bid security",
            citationVerdict: "correct",
            unsupportedClaim: false,
          },
        ],
      }),
    ]);
    report.overallRecall = Number.NaN;
    report.citationCorrectness = 1.1;
    report.fatalMisses = -1;
    report.unsupportedClaimRate = Number.POSITIVE_INFINITY;

    const metrics = new Set(
      evaluateReportAgainstProfile(
        report,
        PRODUCTION_EVAL_PROFILE,
      ).failures.map((failure) => failure.metric),
    );
    assert.equal(metrics.has("overall_recall"), true);
    assert.equal(metrics.has("citation_correctness"), true);
    assert.equal(metrics.has("fatal_misses"), true);
    assert.equal(metrics.has("unsupported_claim_rate"), true);
  });
});

describe("manifest-backed corpus contract", () => {
  const manifestFor = (
    tenders: EvalTender[],
    overrides: Partial<EvalCorpusManifest> = {},
  ): EvalCorpusManifest => ({
    schemaVersion: 1,
    corpusVersion: "test-v1",
    purpose: "non_production_self_check",
    limitations: ["Synthetic unit-test corpus."],
    cases: tenders.map((item) => ({
      tenderId: item.id,
      sourceCategory: "synthetic_test",
      sourceReferenceHash: null,
      authorizationBasis: "synthetic_no_customer_data",
      synthetic: true,
      productionEligible: false,
      split: "development",
      cohorts: [],
      annotationStatus: "unverified",
      annotatorIds: [],
      independentReviewerIds: [],
      agreementMethod: null,
      containsRawSensitiveData: false,
    })),
    ...overrides,
  });

  test("accepts an honest synthetic manifest for the non-production profile", () => {
    const tenders = Array.from({ length: 10 }, (_, index) =>
      tender({ id: `synthetic-${index}` }),
    );
    const result = validateCorpusManifest(
      tenders,
      manifestFor(tenders),
      GATE0_NON_PRODUCTION_PROFILE,
    );
    assert.equal(result.passed, true);
    assert.equal(result.productionEligible, false);
  });

  test("the same synthetic corpus fails closed for production promotion", () => {
    const tenders = Array.from({ length: 10 }, (_, index) =>
      tender({ id: `synthetic-${index}` }),
    );
    const result = validateCorpusManifest(
      tenders,
      manifestFor(tenders),
      PRODUCTION_EVAL_PROFILE,
    );
    assert.equal(result.passed, false);
    assert.ok(
      result.problems.some((problem) => problem.includes("need >= 25")),
    );
    assert.ok(
      result.problems.some((problem) => problem.includes("synthetic case")),
    );
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("production cohort missing"),
      ),
    );
  });

  test("the positive contract branch is reachable for an in-memory unit fixture", () => {
    // This object only exercises validator logic. It is not exported, retained,
    // or represented as an authorised BidBox evaluation corpus.
    const tenders = Array.from({ length: 25 }, (_, index) =>
      tender({ id: `authorised-${index}` }),
    );
    const cases = tenders.map((item, index) => ({
      tenderId: item.id,
      sourceCategory: "authorised_tender",
      sourceReferenceHash: `sha256:${String(index).padStart(64, "0")}`,
      authorizationBasis: "recorded_test_authorisation",
      synthetic: false,
      productionEligible: true,
      split: "holdout" as const,
      cohorts: index === 0 ? [...REQUIRED_PRODUCTION_COHORTS] : [],
      annotationStatus: "adjudicated" as const,
      annotatorIds: ["annotator-pseudonym"],
      independentReviewerIds: ["reviewer-pseudonym"],
      agreementMethod: "independent review and adjudication",
      containsRawSensitiveData: false,
    }));
    const result = validateCorpusManifest(
      tenders,
      manifestFor(tenders, {
        purpose: "production_holdout",
        cases,
      }),
      PRODUCTION_EVAL_PROFILE,
    );
    assert.equal(result.passed, true);
    assert.equal(result.productionEligible, true);
  });

  test("rejects manifest raw-sensitive-data flags and case drift", () => {
    const tenders = Array.from({ length: 10 }, (_, index) =>
      tender({ id: `synthetic-${index}` }),
    );
    const manifest = manifestFor(tenders);
    manifest.cases[0]!.containsRawSensitiveData = true;
    manifest.limitations = [];
    manifest.cases.pop();
    const result = validateCorpusManifest(
      tenders,
      manifest,
      GATE0_NON_PRODUCTION_PROFILE,
    );
    assert.ok(
      result.problems.some((problem) => problem.includes("raw sensitive data")),
    );
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("manifest entry missing"),
      ),
    );
    assert.ok(
      result.problems.some((problem) => problem.includes("limitations")),
    );
  });
});
