import { describe, expect, it } from "vitest";
import { queryDisplayState } from "./tender-context-route-state";

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
