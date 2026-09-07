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
