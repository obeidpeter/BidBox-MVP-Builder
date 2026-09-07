import {
  assertExactKeys,
  boundedText as sharedBoundedText,
  requireRecord,
  SHA256_PATTERN,
  UUID_PATTERN,
} from "./closed-contract";

export interface CanonicalEvidenceOption {
  documentId: string;
  projectId: string;
  filename: string;
  projectTitle: string;
  sha256: string;
  versionNumber: number;
  detectedMime: string;
  sizeBytes: number;
  privacyEligible: boolean;
}

export interface CanonicalEvidenceBinding {
  documentId: string;
  sha256: string;
}

export interface CanonicalEvidenceOptionsSnapshot {
  limit: number;
  truncated: boolean;
  items: CanonicalEvidenceOption[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  return requireRecord(value, () => {
    throw new Error(`${label} is unavailable`);
  });
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  assertExactKeys(value, keys, () => {
    throw new Error(`${label} contract is unavailable`);
  });
}

function boundedText(value: unknown, label: string, max: number): string {
  return sharedBoundedText(value, max, () => {
    throw new Error(`${label} is unavailable`);
  });
}

export function adaptCanonicalEvidenceOptions(
  value: unknown,
  organisationId: string,
  projectId: string | null,
): CanonicalEvidenceOptionsSnapshot {
  const payload = record(value, "Canonical evidence options");
  exactKeys(
    payload,
    ["organisationId", "projectId", "limit", "truncated", "items"],
    "Canonical evidence options",
  );
  if (
    payload.organisationId !== organisationId ||
    payload.projectId !== projectId ||
    typeof payload.limit !== "number" ||
    !Number.isSafeInteger(payload.limit) ||
    payload.limit < 1 ||
    payload.limit > 100 ||
    typeof payload.truncated !== "boolean" ||
    !Array.isArray(payload.items) ||
    payload.items.length > payload.limit
  ) {
    throw new Error("Canonical evidence option scope is unavailable");
  }
  const documentIds = new Set<string>();
  const items = payload.items.map((entry, index) => {
    const label = `Canonical evidence option ${index + 1}`;
    const item = record(entry, label);
    exactKeys(
      item,
      [
        "documentId",
        "projectId",
        "filename",
        "projectTitle",
        "sha256",
        "versionNumber",
        "detectedMime",
        "sizeBytes",
        "privacyEligible",
      ],
      label,
    );
    const documentId = boundedText(item.documentId, label, 64);
    const optionProjectId = boundedText(item.projectId, label, 64);
    const sha256 = boundedText(item.sha256, label, 64);
    if (
      !UUID_PATTERN.test(documentId) ||
      !UUID_PATTERN.test(optionProjectId) ||
      !SHA256_PATTERN.test(sha256) ||
      (projectId !== null && optionProjectId !== projectId) ||
      documentIds.has(documentId) ||
      typeof item.versionNumber !== "number" ||
      !Number.isSafeInteger(item.versionNumber) ||
      item.versionNumber < 1 ||
      typeof item.sizeBytes !== "number" ||
      !Number.isSafeInteger(item.sizeBytes) ||
      item.sizeBytes < 0 ||
      typeof item.privacyEligible !== "boolean"
    ) {
      throw new Error(`${label} failed canonical validation`);
    }
    documentIds.add(documentId);
    return {
      documentId,
      projectId: optionProjectId,
      filename: boundedText(item.filename, `${label} filename`, 512),
      projectTitle: boundedText(item.projectTitle, `${label} project`, 1_024),
      sha256,
      versionNumber: item.versionNumber,
      detectedMime: boundedText(item.detectedMime, `${label} MIME`, 256),
      sizeBytes: item.sizeBytes,
      privacyEligible: item.privacyEligible,
    };
  });
  return {
    limit: payload.limit,
    truncated: payload.truncated,
    items,
  };
}

export function evidenceBindingsFromOptions(
  options: readonly CanonicalEvidenceOption[],
  documentIds: readonly string[],
): CanonicalEvidenceBinding[] {
  const selected = new Set(documentIds);
  if (selected.size !== documentIds.length) {
    throw new Error("Canonical evidence selection is ambiguous");
  }
  const bindings = options
    .filter((option) => selected.has(option.documentId))
    .map(({ documentId, sha256 }) => ({ documentId, sha256 }));
  if (bindings.length !== selected.size) {
    throw new Error("Canonical evidence selection is no longer available");
  }
  return bindings;
}
