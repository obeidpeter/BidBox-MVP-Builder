export type AuthorityScope = Readonly<Record<string, string>>;

export function authorityScopeIsCurrent<Scope extends AuthorityScope>(
  current: Scope,
  requested: Scope,
): boolean {
  const currentKeys = Object.keys(current);
  const requestedKeys = Object.keys(requested);

  return (
    currentKeys.length === requestedKeys.length &&
    requestedKeys.every(
      (key) =>
        Object.hasOwn(current, key) &&
        Object.is(current[key as keyof Scope], requested[key as keyof Scope]),
    )
  );
}

export function assertAuthorityScopeCurrent<Scope extends AuthorityScope>(
  current: Scope,
  requested: Scope,
  message: string,
): void {
  if (!authorityScopeIsCurrent(current, requested)) {
    throw new Error(message);
  }
}
