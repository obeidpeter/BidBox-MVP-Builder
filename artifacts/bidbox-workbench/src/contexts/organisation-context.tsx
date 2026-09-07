import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  customFetch,
  getGetMeQueryKey,
  setRequestContextGetter,
  useGetMe,
} from "@workspace/api-client-react";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { requestStatus } from "@/lib/errors";

export type OrganisationType = "client" | "valo" | "consultancy_partner";

export interface OrganisationAccess {
  id: string;
  name: string;
  slug: string;
  type: OrganisationType;
  status: string;
  countryCode: string;
  membershipId: string;
  membershipOrganisationId: string;
  accessSource: "membership" | "partner";
  partnerRelationshipId: string | null;
  accessExpiresAt: string | null;
  roles: string[];
  permissions: string[];
  version: number;
}

interface OrganisationContextValue {
  organisations: OrganisationAccess[];
  activeOrganisation: OrganisationAccess | null;
  effectiveRoles: string[];
  effectivePermissions: string[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  needsSelection: boolean;
  isSwitching: boolean;
  hasPendingMutation: boolean;
  hasCriticalWorkflow: boolean;
  beginCriticalWorkflow: () => () => void;
  selectOrganisation: (organisationId: string) => Promise<boolean>;
  refetch: () => void;
}

const OrganisationContext = createContext<OrganisationContextValue | null>(
  null,
);
const SESSION_KEY_PREFIX = "valo:selected-organisation";
const QUERY_PREFIX = "organisation-access";
let activeContextOrganisationId: string | null = null;

setRequestContextGetter(() => ({
  organisationId: activeContextOrganisationId,
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOrganisation(value: unknown): OrganisationAccess | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== "client" && type !== "valo" && type !== "consultancy_partner")
    return null;
  if (
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    typeof value.slug !== "string" ||
    value.status !== "active" ||
    typeof value.membershipId !== "string" ||
    value.membershipId.trim() === "" ||
    typeof value.membershipOrganisationId !== "string" ||
    value.membershipOrganisationId.trim() === "" ||
    (value.accessSource !== "membership" && value.accessSource !== "partner") ||
    (value.partnerRelationshipId !== null &&
      typeof value.partnerRelationshipId !== "string") ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.permissions)
  ) {
    return null;
  }
  if (
    value.accessExpiresAt !== null &&
    value.accessExpiresAt !== undefined &&
    typeof value.accessExpiresAt !== "string"
  ) {
    return null;
  }
  if (
    typeof value.accessExpiresAt === "string" &&
    (Number.isNaN(new Date(value.accessExpiresAt).getTime()) ||
      new Date(value.accessExpiresAt).getTime() <= Date.now())
  ) {
    return null;
  }
  const roles = Array.from(
    new Set(
      value.roles.filter((role): role is string => typeof role === "string"),
    ),
  );
  const permissions = Array.from(
    new Set(
      value.permissions.filter(
        (permission): permission is string =>
          typeof permission === "string" && permission.trim() !== "",
      ),
    ),
  );
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    type,
    status: "active",
    countryCode:
      typeof value.countryCode === "string" ? value.countryCode : "NG",
    membershipId: value.membershipId,
    membershipOrganisationId: value.membershipOrganisationId,
    accessSource: value.accessSource,
    partnerRelationshipId:
      typeof value.partnerRelationshipId === "string"
        ? value.partnerRelationshipId
        : null,
    accessExpiresAt:
      typeof value.accessExpiresAt === "string" ? value.accessExpiresAt : null,
    roles,
    permissions,
    version: typeof value.version === "number" ? value.version : 0,
  };
}

async function listOrganisationAccess(): Promise<OrganisationAccess[]> {
  const response = await customFetch<unknown>("/api/organisations", {
    responseType: "json",
  });
  if (!Array.isArray(response)) {
    throw new Error("Organisation access response is not an array");
  }
  const parsed = response.map(parseOrganisation);
  if (parsed.some((organisation) => organisation === null)) {
    throw new Error("Organisation access response contains an invalid record");
  }
  return parsed as OrganisationAccess[];
}

function selectionStorageKey(identityScope: string): string {
  return `${SESSION_KEY_PREFIX}:${encodeURIComponent(identityScope)}`;
}

function savedOrganisationId(identityScope: string): string | null {
  try {
    return sessionStorage.getItem(selectionStorageKey(identityScope));
  } catch {
    return null;
  }
}

function saveOrganisationId(identityScope: string, value: string | null): void {
  try {
    const key = selectionStorageKey(identityScope);
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage can be disabled. The in-memory selection remains authoritative
    // for this page lifetime and the server still validates every request.
  }
}

export function OrganisationProvider({ children }: { children: ReactNode }) {
  const { userId, sessionId } = useAuth();
  const identityScope =
    userId && sessionId ? `${userId}:${sessionId}` : "unverified";
  const meQuery = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, error) => {
        const status = requestStatus(error);
        if (status === 403) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 2000),
    },
  });
  const user = meQuery.data;
  const queryClient = useQueryClient();
  const pendingMutations = useIsMutating();
  const [selection, setSelection] = useState(() => ({
    identityScope,
    organisationId: savedOrganisationId(identityScope),
  }));
  const [isSwitching, setIsSwitching] = useState(false);
  const [criticalWorkflowCount, setCriticalWorkflowCount] = useState(0);
  const criticalWorkflowCountRef = useRef(0);
  const selectedId =
    selection.identityScope === identityScope ? selection.organisationId : null;
  const accessQuery = useQuery({
    queryKey: [QUERY_PREFIX, identityScope, user?.id ?? "anonymous"],
    queryFn: listOrganisationAccess,
    enabled: Boolean(user && user.status === "active"),
    staleTime: 30_000,
  });

  const organisations = accessQuery.data ?? [];
  const explicitlySelected = organisations.find(
    (organisation) => organisation.id === selectedId,
  );
  const activeOrganisation =
    explicitlySelected ??
    (organisations.length === 1 ? organisations[0] : null);

  // Generated queries read this value immediately when they construct their
  // request. The backend treats it only as a tenant selector and revalidates
  // membership, role grants and access windows.
  activeContextOrganisationId = activeOrganisation?.id ?? null;

  useEffect(() => {
    setSelection({
      identityScope,
      organisationId: savedOrganisationId(identityScope),
    });
    criticalWorkflowCountRef.current = 0;
    setCriticalWorkflowCount(0);
    activeContextOrganisationId = null;
  }, [identityScope]);

  useEffect(() => {
    if (!accessQuery.isSuccess || !selectedId) return;
    if (!organisations.some((organisation) => organisation.id === selectedId)) {
      setSelection({ identityScope, organisationId: null });
      saveOrganisationId(identityScope, null);
    }
  }, [accessQuery.isSuccess, identityScope, organisations, selectedId]);

  useEffect(
    () => () => {
      activeContextOrganisationId = null;
    },
    [],
  );

  const beginCriticalWorkflow = useCallback(() => {
    let released = false;
    criticalWorkflowCountRef.current += 1;
    setCriticalWorkflowCount(criticalWorkflowCountRef.current);
    return () => {
      if (released) return;
      released = true;
      criticalWorkflowCountRef.current = Math.max(
        0,
        criticalWorkflowCountRef.current - 1,
      );
      setCriticalWorkflowCount(criticalWorkflowCountRef.current);
    };
  }, []);

  const selectOrganisation = async (
    organisationId: string,
  ): Promise<boolean> => {
    if (
      isSwitching ||
      criticalWorkflowCountRef.current > 0 ||
      queryClient.isMutating() > 0 ||
      !organisations.some((organisation) => organisation.id === organisationId)
    ) {
      return false;
    }

    setIsSwitching(true);
    try {
      await queryClient.cancelQueries({
        predicate: (query) => query.queryKey[0] !== QUERY_PREFIX,
      });
      activeContextOrganisationId = organisationId;
      saveOrganisationId(identityScope, organisationId);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== QUERY_PREFIX,
      });
      setSelection({ identityScope, organisationId });
      return true;
    } finally {
      setIsSwitching(false);
    }
  };

  const value = useMemo<OrganisationContextValue>(
    () => ({
      organisations,
      activeOrganisation,
      effectiveRoles: activeOrganisation?.roles ?? [],
      effectivePermissions: activeOrganisation?.permissions ?? [],
      isLoading:
        meQuery.isLoading ||
        meQuery.isPending ||
        (Boolean(user && user.status === "active") &&
          (accessQuery.isLoading || accessQuery.isPending)),
      isError: meQuery.isError || accessQuery.isError,
      error: meQuery.error ?? accessQuery.error,
      needsSelection: organisations.length > 1 && !activeOrganisation,
      isSwitching,
      hasPendingMutation: pendingMutations > 0,
      hasCriticalWorkflow: criticalWorkflowCount > 0,
      beginCriticalWorkflow,
      selectOrganisation,
      refetch: () => {
        void accessQuery.refetch();
      },
    }),
    [
      accessQuery,
      activeOrganisation,
      beginCriticalWorkflow,
      criticalWorkflowCount,
      identityScope,
      isSwitching,
      meQuery.error,
      meQuery.isError,
      meQuery.isLoading,
      meQuery.isPending,
      organisations,
      pendingMutations,
      user,
    ],
  );

  return (
    <OrganisationContext.Provider value={value}>
      {children}
    </OrganisationContext.Provider>
  );
}

export function useOrganisationAccess(): OrganisationContextValue | null {
  return useContext(OrganisationContext);
}

export function useOrganisationPermission(permission: string): boolean {
  const access = useContext(OrganisationContext);
  return Boolean(access?.activeOrganisation?.permissions.includes(permission));
}
