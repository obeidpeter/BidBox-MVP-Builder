import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  resolve(import.meta.dirname, "field-draft-promotion-review.tsx"),
  "utf8",
);
const page = readFileSync(
  resolve(import.meta.dirname, "../../pages/encrypted-field-companion.tsx"),
  "utf8",
);

describe("field draft promotion review UI boundary", () => {
  it("does no background fetch and requires an explicit target choice", () => {
    const resetEffect = component.slice(
      component.indexOf("useEffect(() =>"),
      component.indexOf("const assertCurrent"),
    );
    expect(resetEffect).not.toMatch(/customFetch|setInterval|setTimeout/u);
    expect(component).toContain('setTargetId("");');
    expect(component).toContain("Choose a work item");
    expect(component).toContain("Review field differences");
    expect(component).toContain("Promote selected fields");
    expect(component).toContain("Recover prepared promotion");
  });

  it("refreshes before POST and marks only after receipt verification", () => {
    const promote = component.slice(
      component.indexOf("const promote = async"),
      component.indexOf("if (!open)"),
    );
    expect(promote.indexOf("await loadTarget(")).toBeGreaterThanOrEqual(0);
    expect(promote.indexOf('method: "POST"')).toBeGreaterThan(
      promote.indexOf("await loadTarget("),
    );
    expect(
      promote.indexOf("verifyFieldDraftPromotionReceipt("),
    ).toBeGreaterThan(promote.indexOf('method: "POST"'));
    expect(
      promote.indexOf("prepareEncryptedFieldDraftPromotion("),
    ).toBeLessThan(promote.indexOf('method: "POST"'));
    expect(promote.indexOf("retainVerifiedReceipt(receipt")).toBeGreaterThan(
      promote.indexOf("verifyFieldDraftPromotionReceipt("),
    );
    expect(component).not.toMatch(
      /deleteEncryptedFieldDraft|objectStore\([^)]*\)\.delete\(|console\.(?:log|info|debug)/u,
    );
    expect(page).toContain("Delete promoted local draft");
    expect(promote).toContain("beginCriticalWorkflow()");
    expect(promote).toContain("releaseCriticalWorkflow()");
  });
});
