import { describe, expect, it } from "vitest";
import {
  isRulePackJurisdictionCompatible,
  queryDisplayState,
} from "./tender-context-route-state";

describe("Tender Context query display state", () => {
  it("keeps cold and paused queries in loading instead of claiming emptiness", () => {
    expect(
      queryDisplayState({
        isLoading: false,
        isPending: true,
        isError: false,
        isSuccess: false,
        hasData: false,
      }),
    ).toBe("loading");
    expect(
      queryDisplayState({
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: false,
        hasData: false,
      }),
    ).toBe("loading");
  });

  it("distinguishes a source error, successful absence and verified data", () => {
    expect(
      queryDisplayState({
        isLoading: false,
        isPending: false,
        isError: true,
        isSuccess: false,
        hasData: false,
      }),
    ).toBe("error");
    expect(
      queryDisplayState({
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        hasData: false,
      }),
    ).toBe("unavailable");
    expect(
      queryDisplayState({
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        hasData: true,
      }),
    ).toBe("ready");
  });
});

describe("Tender Context rule-pack jurisdiction compatibility", () => {
  it("accepts an exact jurisdiction and the national Nigeria fallback", () => {
    expect(isRulePackJurisdictionCompatible("NG", "NG")).toBe(true);
    expect(isRulePackJurisdictionCompatible("NG-LA", "NG-LA")).toBe(true);
    expect(isRulePackJurisdictionCompatible(" ng ", " ng-la ")).toBe(true);
  });

  it("rejects a narrower pack for Nigeria, sibling subdivisions and invalid codes", () => {
    expect(isRulePackJurisdictionCompatible("NG-LA", "NG")).toBe(false);
    expect(isRulePackJurisdictionCompatible("NG-LA", "NG-KN")).toBe(false);
    expect(isRulePackJurisdictionCompatible("NG", "Nigeria")).toBe(false);
    expect(isRulePackJurisdictionCompatible("", "NG")).toBe(false);
  });
});
