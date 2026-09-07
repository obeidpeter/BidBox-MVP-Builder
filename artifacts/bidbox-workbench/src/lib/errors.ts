import type { useToast } from "@/hooks/use-toast";

/**
 * Pull the server's human-readable error message off a failed request.
 *
 * customFetch attaches the parsed JSON body as `err.data`, so a server
 * `{ error: "..." }` envelope beats the generic Error message; the fallback
 * is used only when neither is available.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  const serverError =
    data &&
    typeof data === "object" &&
    typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : undefined;
  if (serverError) return serverError;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

type ToastFunction = ReturnType<typeof useToast>["toast"];

/**
 * Build the standard destructive mutation `onError` handler: a toast whose
 * description is the server's error message with a per-site fallback (empty
 * by default, matching the previously inlined copies).
 */
export function mutationErrorToast(
  toast: ToastFunction,
  title: string,
  fallback = "",
): (err: unknown) => void {
  return (err) => {
    toast({
      variant: "destructive",
      title,
      description: errorMessage(err, fallback),
    });
  };
}

/**
 * Read the HTTP status customFetch attaches to failed requests, guarding the
 * shape instead of casting at each call site.
 */
export function requestStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
