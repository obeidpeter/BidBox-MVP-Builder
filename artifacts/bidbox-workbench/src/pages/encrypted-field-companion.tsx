import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getListProjectsQueryKey,
  useGetMe,
  useListProjects,
} from "@workspace/api-client-react";
import { ClipboardList, LockKeyhole, ShieldAlert, WifiOff } from "lucide-react";
import { FieldDraftPromotionReview } from "@/components/encrypted-field/field-draft-promotion-review";
import {
  LoadingPanel,
  PageGatePanel,
  PageHeader,
  StatusPanel,
} from "@/components/platform-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import {
  deleteEncryptedFieldDraft,
  ENCRYPTED_FIELD_BOUNDS,
  ENCRYPTED_FIELD_COMPANION_STATUS,
  EncryptedFieldCompanionError,
  listEncryptedFieldDrafts,
  saveEncryptedFieldDraft,
  wipeEncryptedFieldCompanion,
  type EncryptedFieldDraft,
  type EncryptedFieldDraftKind,
} from "@/lib/encrypted-offline-field";

const KIND_LABELS: Record<EncryptedFieldDraftKind, string> = {
  site_visit_note: "Site-visit note",
  delivery_receipt_note: "Delivery receipt note",
  checklist_progress: "Checklist progress",
};

const inputTimestamp = (value = new Date()): string => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export default function EncryptedFieldCompanionPage() {
  const access = useOrganisationAccess();
  const meQuery = useGetMe();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const organisationId = access?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const actorLabel =
    meQuery.data?.name?.trim() || meQuery.data?.email?.trim() || "";
  const permissions = access?.effectivePermissions ?? [];
  const direct =
    access?.activeOrganisation?.accessSource === "membership" &&
    access.activeOrganisation.membershipOrganisationId === organisationId;
  const canUse = Boolean(
    organisationId &&
    actorUserId &&
    direct &&
    permissions.includes("project:read"),
  );
  const canPromote = canUse && permissions.includes("project:update");
  const activeScopeRef = useRef({ organisationId, actorUserId });
  activeScopeRef.current = { organisationId, actorUserId };
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [...getListProjectsQueryKey(), organisationId, actorUserId],
      enabled: online && canUse,
    },
  });
  const projects = projectsQuery.data ?? [];
  const [drafts, setDrafts] = useState<EncryptedFieldDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<EncryptedFieldDraft | null>(null);
  const [kind, setKind] = useState<EncryptedFieldDraftKind>("site_visit_note");
  const [wipeConfirmation, setWipeConfirmation] = useState("");
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const refresh = async (
    expectedOrganisationId = organisationId,
    expectedActorUserId = actorUserId,
  ) => {
    if (
      !canUse ||
      expectedOrganisationId !== organisationId ||
      expectedActorUserId !== actorUserId
    )
      return;
    setLoading(true);
    setError(null);
    try {
      const nextDrafts = await listEncryptedFieldDrafts(
        expectedOrganisationId,
        expectedActorUserId,
      );
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      setDrafts(nextDrafts);
    } catch (caught) {
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      setDrafts([]);
      setError(
        caught instanceof EncryptedFieldCompanionError
          ? `Encrypted local storage is unavailable (${caught.code}).`
          : "Encrypted local storage is unavailable.",
      );
    } finally {
      if (
        activeScopeRef.current.organisationId === expectedOrganisationId &&
        activeScopeRef.current.actorUserId === expectedActorUserId
      )
        setLoading(false);
    }
  };

  useEffect(() => {
    setDrafts([]);
    setError(null);
    setPending(false);
    setEditing(null);
    setKind("site_visit_note");
    setWipeConfirmation("");
    if (canUse) void refresh();
    else setLoading(false);
    // Refresh deliberately follows the exact active tenant boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId, actorUserId, canUse]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expectedOrganisationId = organisationId;
    const expectedActorUserId = actorUserId;
    const form = event.currentTarget;
    const data = new FormData(form);
    const checklist = String(data.get("checklist") ?? "")
      .split(/\r?\n/u)
      .map((label) => label.trim())
      .filter(Boolean)
      .slice(0, ENCRYPTED_FIELD_BOUNDS.checklistItems)
      .map((label, index) => ({
        id: `item-${index + 1}`,
        label,
        completed:
          editing?.checklist.find((item) => item.label === label)?.completed ??
          false,
      }));
    setPending(true);
    setError(null);
    try {
      await saveEncryptedFieldDraft({
        id: editing?.id,
        expectedVersion: editing?.version,
        organisationId: expectedOrganisationId,
        actorUserId: expectedActorUserId,
        kind,
        projectId: online
          ? String(data.get("projectId") ?? "") || null
          : (editing?.projectId ?? null),
        title: String(data.get("title") ?? "").trim(),
        note: String(data.get("note") ?? "").trim(),
        checklist,
        capturedAt: new Date(String(data.get("capturedAt"))).toISOString(),
      });
      form.reset();
      setEditing(null);
      setKind("site_visit_note");
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      await refresh(expectedOrganisationId, expectedActorUserId);
      toast({ title: "Encrypted device draft saved" });
    } catch (caught) {
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      setError(
        caught instanceof EncryptedFieldCompanionError
          ? `Draft was not saved (${caught.code}).`
          : "Draft was not saved.",
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async (draft: EncryptedFieldDraft) => {
    const expectedOrganisationId = organisationId;
    const expectedActorUserId = actorUserId;
    setPending(true);
    try {
      await deleteEncryptedFieldDraft(
        expectedOrganisationId,
        expectedActorUserId,
        draft.id,
        draft.version,
      );
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      await refresh(expectedOrganisationId, expectedActorUserId);
      toast({ title: "Local encrypted draft deleted" });
    } catch (caught) {
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      setError(
        caught instanceof EncryptedFieldCompanionError
          ? `Draft was not deleted (${caught.code}).`
          : "Draft was not deleted.",
      );
    } finally {
      setPending(false);
    }
  };

  const toggleChecklist = async (
    draft: EncryptedFieldDraft,
    itemId: string,
  ) => {
    const expectedOrganisationId = organisationId;
    const expectedActorUserId = actorUserId;
    setPending(true);
    setError(null);
    try {
      await saveEncryptedFieldDraft({
        id: draft.id,
        expectedVersion: draft.version,
        organisationId: expectedOrganisationId,
        actorUserId: expectedActorUserId,
        kind: draft.kind,
        projectId: draft.projectId,
        title: draft.title,
        note: draft.note,
        checklist: draft.checklist.map((item) =>
          item.id === itemId ? { ...item, completed: !item.completed } : item,
        ),
        capturedAt: draft.capturedAt,
      });
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      await refresh(expectedOrganisationId, expectedActorUserId);
    } catch (caught) {
      if (
        activeScopeRef.current.organisationId !== expectedOrganisationId ||
        activeScopeRef.current.actorUserId !== expectedActorUserId
      )
        return;
      setError(
        caught instanceof EncryptedFieldCompanionError
          ? `Checklist revision was not saved (${caught.code}).`
          : "Checklist revision was not saved.",
      );
    } finally {
      setPending(false);
    }
  };

  if (meQuery.isLoading)
    return (
      <div className="p-5 sm:p-8">
        <LoadingPanel label="Checking who owns these device drafts" />
      </div>
    );

  if (!canUse)
    return (
      <PageGatePanel
        state="blocked"
        title="Direct pursuit membership required"
        description="Device drafts are separated by signed-in user and direct organisation membership. Partner and emergency access cannot open these local drafts."
      />
    );

  return (
    <main className="space-y-6 p-5 sm:p-8">
      <PageHeader
        eyebrow="Local field workspace"
        title="Field notes"
        description="Write short draft notes and update checklists during this signed-in session. After reconnecting, a named person can review selected fields against an existing work item. Drafts never become evidence or approval and stay on this device after a verified receipt."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <LockKeyhole
            aria-hidden="true"
            className="mt-0.5 size-5 text-primary"
          />
          <div>
            <p className="font-medium">Encrypted locally</p>
            <p className="text-sm text-muted-foreground">
              Encrypted with a device key tied to the signed-in user and
              organisation.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <WifiOff aria-hidden="true" className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">No automatic upload</p>
            <p className="text-sm text-muted-foreground">
              Reconnect, choose one compatible work item, review the field
              changes and confirm the copy.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 size-5 text-primary"
          />
          <div>
            <p className="font-medium">Draft-only boundary</p>
            <p className="text-sm text-muted-foreground">
              No files, photos, tender corpus, decisions, approvals or final
              receipts.
            </p>
          </div>
        </div>
      </div>

      {!online ? (
        <StatusPanel
          state="offline"
          title="Offline draft mode"
          description="Only encrypted device drafts are available. Project names may be unavailable and nothing can be submitted."
        />
      ) : null}
      {error ? (
        <StatusPanel
          state="error"
          title="Field note action failed"
          description={error}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {editing ? "Edit encrypted draft" : "New encrypted draft"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              key={editing?.id ?? "new"}
              className="space-y-4"
              onSubmit={submit}
            >
              <div className="grid gap-2">
                <Label htmlFor="field-kind">Draft type</Label>
                <select
                  id="field-kind"
                  className="min-h-11 rounded-md border bg-background px-3"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as EncryptedFieldDraftKind)
                  }
                >
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="field-project">Pursuit (optional)</Label>
                <select
                  id="field-project"
                  name="projectId"
                  className="min-h-11 rounded-md border bg-background px-3"
                  defaultValue={editing?.projectId ?? ""}
                  disabled={!online}
                >
                  <option value="">No server pursuit reference</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.tenderTitle}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="field-title">Title</Label>
                <Input
                  id="field-title"
                  name="title"
                  defaultValue={editing?.title}
                  maxLength={ENCRYPTED_FIELD_BOUNDS.titleCodeUnits}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="field-captured">Captured at</Label>
                <Input
                  id="field-captured"
                  name="capturedAt"
                  type="datetime-local"
                  defaultValue={
                    editing
                      ? inputTimestamp(new Date(editing.capturedAt))
                      : inputTimestamp()
                  }
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="field-note">Draft note</Label>
                <Textarea
                  id="field-note"
                  name="note"
                  defaultValue={editing?.note}
                  maxLength={ENCRYPTED_FIELD_BOUNDS.noteCodeUnits}
                  rows={7}
                  placeholder="Do not enter credentials, Restricted Mode tender content or an approval decision."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="field-checklist">
                  Checklist items (one per line, optional)
                </Label>
                <Textarea
                  id="field-checklist"
                  name="checklist"
                  defaultValue={editing?.checklist
                    .map(({ label }) => label)
                    .join("\n")}
                  rows={5}
                  placeholder="Arrival logged&#10;Attendance proof collected"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="min-h-11" disabled={pending}>
                  {editing ? "Save encrypted revision" : "Save encrypted draft"}
                </Button>
                {editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setEditing(null);
                      setKind("site_visit_note");
                    }}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <section aria-labelledby="device-drafts-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="device-drafts-heading" className="text-xl font-semibold">
                This device
              </h2>
              <p className="text-sm text-muted-foreground">
                {drafts.length}/{ENCRYPTED_FIELD_BOUNDS.draftsPerOrganisation}{" "}
                encrypted drafts for the active organisation.
              </p>
            </div>
            <Badge variant="outline">Not submitted</Badge>
          </div>
          {loading ? (
            <StatusPanel
              state="pending"
              title="Decrypting local drafts"
              description="Checking the device key, organisation boundary and encrypted data."
            />
          ) : drafts.length ? (
            drafts.map((draft) => (
              <Card key={draft.id}>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base">{draft.title}</CardTitle>
                    <Badge variant="secondary">{KIND_LABELS[draft.kind]}</Badge>
                    {draft.promotion ? (
                      <Badge variant="outline">Copied to work item</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(draft.updatedAt).toLocaleString()} ·
                    version {draft.version} · expires{" "}
                    {new Date(draft.expiresAt).toLocaleString()}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {draft.projectId ? (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Pursuit: </span>
                      {projectsById.get(draft.projectId)?.tenderTitle ??
                        "Bound project reference unavailable offline"}
                    </p>
                  ) : null}
                  {draft.note ? (
                    <p className="whitespace-pre-wrap text-sm">{draft.note}</p>
                  ) : null}
                  {draft.checklist.length ? (
                    <ul className="space-y-2">
                      {draft.checklist.map((item) => (
                        <li key={item.id}>
                          <label className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm">
                            <input
                              type="checkbox"
                              checked={item.completed}
                              disabled={
                                pending ||
                                Boolean(draft.promotion) ||
                                Boolean(draft.pendingPromotion)
                              }
                              onChange={() =>
                                void toggleChecklist(draft, item.id)
                              }
                            />
                            <ClipboardList
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span
                              className={
                                item.completed
                                  ? "text-muted-foreground line-through"
                                  : undefined
                              }
                            >
                              {item.label}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={pending || Boolean(draft.pendingPromotion)}
                      onClick={() => {
                        setEditing(draft);
                        setKind(draft.kind);
                      }}
                    >
                      {draft.promotion ? "Revise local draft" : "Edit draft"}
                    </Button>
                    {!draft.promotion ? (
                      <FieldDraftPromotionReview
                        draft={draft}
                        organisationId={organisationId}
                        actorUserId={actorUserId}
                        actorLabel={actorLabel}
                        projectTitle={
                          (draft.projectId
                            ? projectsById.get(draft.projectId)?.tenderTitle
                            : null) ?? "Selected pursuit"
                        }
                        online={online}
                        canPromote={canPromote}
                        disabled={pending}
                        beginCriticalWorkflow={
                          access?.beginCriticalWorkflow ??
                          (() => () => undefined)
                        }
                        onMarked={async () => {
                          await refresh(organisationId, actorUserId);
                          toast({
                            title: "Copy to work item recorded",
                            description:
                              "The verified receipt is marked on the retained encrypted draft. Delete it only when you choose.",
                          });
                        }}
                      />
                    ) : (
                      <p className="basis-full text-sm text-muted-foreground">
                        Verified receipt{" "}
                        {draft.promotion.receiptSha256.slice(0, 12)}… recorded
                        for target version {draft.promotion.targetVersion}. The
                        encrypted draft is still local and is not evidence.
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      className="min-h-11"
                      disabled={pending || Boolean(draft.pendingPromotion)}
                      onClick={() => void remove(draft)}
                    >
                      {draft.promotion
                        ? "Delete promoted local draft"
                        : "Delete local draft"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <StatusPanel
              state="empty"
              title="No field note drafts on this device"
              description="No blank or uploaded draft is shown."
            />
          )}
        </section>
      </div>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base">My device-draft wipe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This deletes this signed-in user&apos;s local encryption key and all
            of their Valo field drafts across every organisation in this browser
            profile. Other users&apos; actor-bound drafts are not opened or
            deleted. It cannot be undone.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Type WIPE MY DRAFTS to confirm"
              value={wipeConfirmation}
              onChange={(event) => setWipeConfirmation(event.target.value)}
              placeholder="WIPE MY DRAFTS"
              className="sm:max-w-xs"
            />
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={pending || wipeConfirmation !== "WIPE MY DRAFTS"}
              onClick={() => {
                const expectedActorUserId = actorUserId;
                setPending(true);
                void wipeEncryptedFieldCompanion(expectedActorUserId)
                  .then(() => {
                    if (
                      activeScopeRef.current.actorUserId !== expectedActorUserId
                    )
                      return;
                    setDrafts([]);
                    setWipeConfirmation("");
                    toast({ title: "Encrypted field storage wiped" });
                  })
                  .catch(() =>
                    setError(
                      "The local device store could not be wiped. Close other Valo tabs and retry.",
                    ),
                  )
                  .finally(() => {
                    if (
                      activeScopeRef.current.actorUserId === expectedActorUserId
                    )
                      setPending(false);
                  });
              }}
            >
              Wipe my local drafts
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Security contract: encrypted at rest{" "}
        {String(ENCRYPTED_FIELD_COMPANION_STATUS.encryptedAtRest)}; key
        extractable {String(ENCRYPTED_FIELD_COMPANION_STATUS.keyExtractable)};
        automatic sync{" "}
        {String(ENCRYPTED_FIELD_COMPANION_STATUS.automaticSyncAllowed)}.
      </p>
    </main>
  );
}
