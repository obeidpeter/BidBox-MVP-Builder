export interface QueryDisplayInput {
  readonly isLoading: boolean;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly hasData: boolean;
}

export type QueryDisplayState = "loading" | "error" | "unavailable" | "ready";

/** Keeps cold or paused tenant queries distinct from a successful empty result. */
export function queryDisplayState(input: QueryDisplayInput): QueryDisplayState {
  if (
    input.isLoading ||
    input.isPending ||
    (!input.isSuccess && !input.isError)
  ) {
    return "loading";
  }
  if (input.isError) return "error";
  return input.hasData ? "ready" : "unavailable";
}

const NIGERIA_JURISDICTION_PATTERN = /^NG(?:-[A-Z0-9]{1,12})?$/u;

/** Mirrors the server rule: a national pack covers Nigeria and its subdivisions. */
export function isRulePackJurisdictionCompatible(
  rulePackJurisdiction: string,
  requestedJurisdiction: string,
): boolean {
  const pack = rulePackJurisdiction.trim().toUpperCase();
  const requested = requestedJurisdiction.trim().toUpperCase();

  if (
    !NIGERIA_JURISDICTION_PATTERN.test(pack) ||
    !NIGERIA_JURISDICTION_PATTERN.test(requested)
  ) {
    return false;
  }

  return pack === requested || (pack === "NG" && requested.startsWith("NG-"));
}
