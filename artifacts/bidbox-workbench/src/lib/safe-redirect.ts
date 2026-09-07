import { classifyRoute } from "./route-classification";

export function safePostAuthRedirect(
  requested: string | null,
  origin: string,
): string {
  if (!requested || !requested.startsWith("/") || requested.includes("\\")) {
    return "/app";
  }

  try {
    const candidate = new URL(requested, origin);
    if (candidate.origin !== origin) return "/app";
    const target = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    return classifyRoute(target) === "protected" ? target : "/app";
  } catch {
    return "/app";
  }
}
