import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, FileLock2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import {
  APPROVED_PUBLIC_ORIGIN,
  PublicMeta,
} from "@/components/public/public-meta";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearBidAutopsyOperationState,
  createBidAutopsyIdempotencyKey,
  digestBidAutopsyPayload,
  isBidAutopsyOperationStateCurrent,
  loadBidAutopsyOperationState,
  saveBidAutopsyOperationState,
  submitBidAutopsyRequest,
  BidAutopsyRequestError,
  type BidAutopsyOperationState,
  type BidAutopsyRequestPayload,
  type BidAutopsyRequestReceipt,
  type BidStage,
  type PreferredContactMethod,
  type TenderCategory,
} from "@/lib/public-bid-autopsy";

type FieldName =
  | "contactName"
  | "companyName"
  | "businessEmail"
  | "businessTelephone"
  | "tenderCategory"
  | "bidStage"
  | "tenderDeadline"
  | "preferredContactMethod"
  | "privacyNoticeAcknowledged";

interface FormValues {
  contactName: string;
  companyName: string;
  businessEmail: string;
  businessTelephone: string;
  tenderCategory: "" | TenderCategory;
  bidStage: "" | BidStage;
  tenderDeadline: string;
  preferredContactMethod: "" | PreferredContactMethod;
  privacyNoticeAcknowledged: boolean;
  website: string;
}

type FormErrors = Partial<Record<FieldName, string>>;
type SubmissionState = "idle" | "submitting" | "error" | "success";

interface SubmissionErrorCopy {
  title: string;
  message: string;
  retryable: boolean;
}

const initialValues: FormValues = {
  contactName: "",
  companyName: "",
  businessEmail: "",
  businessTelephone: "",
  tenderCategory: "",
  bidStage: "",
  tenderDeadline: "",
  preferredContactMethod: "",
  privacyNoticeAcknowledged: false,
  website: "",
};

const inputClassName = "min-h-11 bg-card px-3 py-2 text-base md:text-base";
const selectClassName =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const telephonePattern = /^(?=(?:\D*\d){7,})[+()0-9 .-]{7,32}$/;

function Field({
  id,
  label,
  hint,
  error,
  required = true,
  children,
}: {
  id: FieldName;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {hint ? (
        <p
          id={`${id}-hint`}
          className="mt-1 text-xs leading-5 text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(field: FieldName, hasHint: boolean, error?: string) {
  return (
    [hasHint ? `${field}-hint` : null, error ? `${field}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function normaliseSingleLine(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function isRealIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const contactName = normaliseSingleLine(values.contactName);
  const companyName = normaliseSingleLine(values.companyName);
  const businessEmail = values.businessEmail.trim();
  const businessTelephone = normaliseSingleLine(values.businessTelephone);

  if (
    contactName.length < 2 ||
    contactName.length > 120 ||
    controlCharacterPattern.test(contactName)
  ) {
    errors.contactName = "Enter a contact name between 2 and 120 characters.";
  }
  if (
    companyName.length < 2 ||
    companyName.length > 160 ||
    controlCharacterPattern.test(companyName)
  ) {
    errors.companyName = "Enter a company name between 2 and 160 characters.";
  }
  if (
    businessEmail.length < 5 ||
    businessEmail.length > 254 ||
    controlCharacterPattern.test(businessEmail) ||
    !emailPattern.test(businessEmail)
  ) {
    errors.businessEmail = "Enter a valid business email address.";
  }
  if (
    businessTelephone.length < 7 ||
    businessTelephone.length > 32 ||
    controlCharacterPattern.test(businessTelephone) ||
    !telephonePattern.test(businessTelephone)
  ) {
    errors.businessTelephone = "Enter a valid business telephone number.";
  }
  if (!values.tenderCategory)
    errors.tenderCategory = "Select a tender category.";
  if (!values.bidStage) errors.bidStage = "Select the current bid stage.";
  if (values.tenderDeadline && !isRealIsoDate(values.tenderDeadline)) {
    errors.tenderDeadline = "Enter a valid tender deadline.";
  }
  if (!values.preferredContactMethod) {
    errors.preferredContactMethod = "Select a preferred contact method.";
  }
  if (!values.privacyNoticeAcknowledged) {
    errors.privacyNoticeAcknowledged =
      "Confirm that you have read the privacy notice.";
  }

  return errors;
}

function toPayload(
  values: FormValues,
  formStartedAt: string,
): BidAutopsyRequestPayload {
  if (
    !values.tenderCategory ||
    !values.bidStage ||
    !values.preferredContactMethod
  ) {
    throw new Error("Validated request fields are missing.");
  }

  return {
    contactName: normaliseSingleLine(values.contactName),
    companyName: normaliseSingleLine(values.companyName),
    businessEmail: normaliseSingleLine(values.businessEmail).toLowerCase(),
    businessTelephone: normaliseSingleLine(values.businessTelephone),
    tenderCategory: values.tenderCategory,
    bidStage: values.bidStage,
    ...(values.tenderDeadline ? { tenderDeadline: values.tenderDeadline } : {}),
    preferredContactMethod: values.preferredContactMethod,
    privacyNoticeAcknowledged: true,
    formStartedAt,
    website: values.website,
  };
}

function normalisedBusinessPayload(values: FormValues) {
  return JSON.stringify({
    contactName: normaliseSingleLine(values.contactName),
    companyName: normaliseSingleLine(values.companyName),
    businessEmail: normaliseSingleLine(values.businessEmail).toLowerCase(),
    businessTelephone: normaliseSingleLine(values.businessTelephone),
    tenderCategory: values.tenderCategory,
    bidStage: values.bidStage,
    tenderDeadline: values.tenderDeadline || null,
    preferredContactMethod: values.preferredContactMethod,
    privacyNoticeAcknowledged: values.privacyNoticeAcknowledged,
    website: values.website,
  });
}

function focusFeedback(element: HTMLElement | null) {
  if (!element) return;
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "start" });
  root.style.scrollBehavior = previousScrollBehavior;
}

export default function RequestBidAutopsyPage() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [submissionError, setSubmissionError] =
    useState<SubmissionErrorCopy | null>(null);
  const [receipt, setReceipt] = useState<BidAutopsyRequestReceipt | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusErrorSummaryRef = useRef(false);
  const operationStateRef = useRef<BidAutopsyOperationState | null>(null);
  if (operationStateRef.current === null) {
    operationStateRef.current = loadBidAutopsyOperationState();
  }
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!shouldFocusErrorSummaryRef.current) return;
    shouldFocusErrorSummaryRef.current = false;
    focusFeedback(errorSummaryRef.current);
  }, [errors]);

  useEffect(() => {
    if (submissionState !== "success") return;
    focusFeedback(successHeadingRef.current);
  }, [submissionState]);

  function markPayloadChanged() {
    if (submissionState !== "error" || submissionError?.retryable === false)
      return;
    setSubmissionState("idle");
    setSubmissionError(null);
  }

  function replaceOperationState({ resetStart }: { resetStart: boolean }) {
    const current = operationStateRef.current ?? loadBidAutopsyOperationState();
    const replacement: BidAutopsyOperationState = {
      ...current,
      idempotencyKey: createBidAutopsyIdempotencyKey(),
      formStartedAt: resetStart
        ? new Date().toISOString()
        : current.formStartedAt,
      payloadDigest: null,
    };
    operationStateRef.current = replacement;
    saveBidAutopsyOperationState(replacement);
  }

  function failureCopy(error: unknown): SubmissionErrorCopy {
    if (!(error instanceof BidAutopsyRequestError)) {
      return {
        title: "We could not confirm your request.",
        message:
          "Check your connection and try again. If the details are unchanged, Valo will retry the same request instead of creating a duplicate.",
        retryable: true,
      };
    }

    if (error.status === 429) {
      const wait =
        error.retryAfterSeconds && error.retryAfterSeconds > 0
          ? ` Wait at least ${error.retryAfterSeconds} seconds.`
          : " Wait before trying again.";
      return {
        title: "Please wait before trying again.",
        message: `Valo is temporarily limiting repeated requests.${wait} Your form details remain on this page.`,
        retryable: true,
      };
    }
    if (error.status === 409) {
      replaceOperationState({ resetStart: false });
      return {
        title: "This request is ready to retry.",
        message:
          "The previous retry did not match these details. Review the form, then submit it again.",
        retryable: true,
      };
    }
    if (error.status === 400) {
      replaceOperationState({ resetStart: true });
      return {
        title: "This request page was refreshed.",
        message:
          "Review the form, wait a moment, then submit it again. If this message returns, stop retrying and reload the official Valo page.",
        retryable: true,
      };
    }
    if (error.status === 403) {
      return {
        title: "This page cannot accept your request.",
        message:
          "Do not keep retrying. Return to the official Valo site, then reopen the Bid Autopsy request page.",
        retryable: false,
      };
    }
    if (error.status === 503) {
      return {
        title: "Bid Autopsy requests are temporarily unavailable.",
        message:
          "We could not confirm your request. Keep the details on this page and try again later. Valo will safely reuse the same request.",
        retryable: true,
      };
    }
    return {
      title: "We could not confirm your request.",
      message:
        "Try again with the same details. Valo will reuse the request instead of creating a duplicate.",
      retryable: true,
    };
  }

  function updateTextField(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget.name as keyof FormValues;
    const value = event.currentTarget.value;
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== "website") {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
    markPayloadChanged();
  }

  function updateSelect(event: ChangeEvent<HTMLSelectElement>) {
    const field = event.currentTarget.name as FieldName;
    const value = event.currentTarget.value;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    markPayloadChanged();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionState === "submitting") return;

    const nextErrors = validate(values);
    shouldFocusErrorSummaryRef.current = Object.keys(nextErrors).length > 0;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSubmissionState("idle");
      return;
    }

    if (!isBidAutopsyOperationStateCurrent(operationStateRef.current)) {
      replaceOperationState({ resetStart: true });
      setSubmissionError({
        title: "This request page was refreshed.",
        message:
          "This page was open for too long. Review the form, wait a moment, then submit it again.",
        retryable: true,
      });
      setSubmissionState("error");
      return;
    }

    setSubmissionState("submitting");
    setSubmissionError(null);
    abortControllerRef.current = new AbortController();
    try {
      const nextPayloadDigest = await digestBidAutopsyPayload(
        normalisedBusinessPayload(values),
      );
      const operationState =
        operationStateRef.current ?? loadBidAutopsyOperationState();
      operationStateRef.current = operationState;
      if (
        operationState.payloadDigest !== null &&
        operationState.payloadDigest !== nextPayloadDigest
      ) {
        operationState.idempotencyKey = createBidAutopsyIdempotencyKey();
      }
      operationState.payloadDigest = nextPayloadDigest;
      saveBidAutopsyOperationState(operationState);

      const nextReceipt = await submitBidAutopsyRequest(
        toPayload(values, operationState.formStartedAt),
        operationState.idempotencyKey,
        abortControllerRef.current.signal,
      );
      clearBidAutopsyOperationState();
      setReceipt(nextReceipt);
      setSubmissionState("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSubmissionError(failureCopy(error));
      setSubmissionState("error");
    } finally {
      abortControllerRef.current = null;
    }
  }

  const errorEntries = Object.entries(errors).filter(
    (entry): entry is [FieldName, string] => Boolean(entry[1]),
  );
  const disabled = submissionState === "submitting";
  const retryBlocked =
    submissionState === "error" && submissionError?.retryable === false;

  return (
    <PublicShell>
      <PublicMeta
        title="Request a Bid Autopsy"
        description="Ask Valo for a Bid Autopsy using ordinary business contact details. Share tender documents only after the client agreement and secure document-sharing process are approved."
        path="/request-bid-autopsy"
      />

      <section className="border-b border-border bg-card">
        <div className="content-shell py-12 sm:py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            First contact
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            Request a Bid Autopsy
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Tell us who to contact and the type and stage of the tender. Do not
            include tender documents, sign-in details or other credentials,
            financial schedules or sensitive bid details here.
          </p>
        </div>
      </section>

      <section className="content-shell grid gap-8 py-12 sm:py-16 lg:grid-cols-[1fr_0.46fr] lg:items-start lg:gap-12">
        <div className="border border-border bg-card p-5 sm:p-8">
          {submissionState === "success" && receipt ? (
            <div role="status" aria-live="polite" className="py-4 sm:py-8">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
                <Check aria-hidden="true" className="size-6" />
              </span>
              <h2
                ref={successHeadingRef}
                tabIndex={-1}
                className="mt-6 scroll-mt-24 rounded-sm text-2xl font-semibold tracking-[-0.025em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Your request has been received.
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                {receipt.nextStep} Do not send tender documents through this
                public form.
              </p>
              <p className="mt-5 text-xs text-muted-foreground">
                Request ID:{" "}
                <span className="font-mono">{receipt.requestId}</span>
              </p>
              <Button asChild variant="outline" className="mt-8 min-h-11">
                <Link href="/">Return to Valo</Link>
              </Button>
            </div>
          ) : (
            <form noValidate onSubmit={handleSubmit} aria-busy={disabled}>
              <div className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    Business contact details
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Fields marked * are required.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Documents cannot be uploaded here
                </p>
              </div>

              {errorEntries.length > 0 ? (
                <div
                  ref={errorSummaryRef}
                  role="alert"
                  tabIndex={-1}
                  aria-labelledby="bid-autopsy-error-title"
                  className="mt-6 scroll-mt-24 border border-destructive/40 bg-destructive/5 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <h3
                    id="bid-autopsy-error-title"
                    className="font-semibold text-destructive"
                  >
                    Check the information below
                  </h3>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                    {errorEntries.map(([field, message]) => (
                      <li key={field}>
                        <a
                          href={`#${field}`}
                          className="underline underline-offset-2"
                        >
                          {message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-7 grid gap-6 sm:grid-cols-2">
                <Field
                  id="contactName"
                  label="Contact name"
                  error={errors.contactName}
                >
                  <Input
                    id="contactName"
                    name="contactName"
                    value={values.contactName}
                    onChange={updateTextField}
                    autoComplete="name"
                    maxLength={120}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.contactName)}
                    aria-describedby={describedBy(
                      "contactName",
                      false,
                      errors.contactName,
                    )}
                    className={inputClassName}
                  />
                </Field>
                <Field
                  id="companyName"
                  label="Company"
                  error={errors.companyName}
                >
                  <Input
                    id="companyName"
                    name="companyName"
                    value={values.companyName}
                    onChange={updateTextField}
                    autoComplete="organization"
                    maxLength={160}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.companyName)}
                    aria-describedby={describedBy(
                      "companyName",
                      false,
                      errors.companyName,
                    )}
                    className={inputClassName}
                  />
                </Field>
                <Field
                  id="businessEmail"
                  label="Business email"
                  hint="Use an address you can access for follow-up."
                  error={errors.businessEmail}
                >
                  <Input
                    id="businessEmail"
                    name="businessEmail"
                    type="email"
                    value={values.businessEmail}
                    onChange={updateTextField}
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.businessEmail)}
                    aria-describedby={describedBy(
                      "businessEmail",
                      true,
                      errors.businessEmail,
                    )}
                    className={inputClassName}
                  />
                </Field>
                <Field
                  id="businessTelephone"
                  label="Business telephone number"
                  error={errors.businessTelephone}
                >
                  <Input
                    id="businessTelephone"
                    name="businessTelephone"
                    type="tel"
                    value={values.businessTelephone}
                    onChange={updateTextField}
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={32}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.businessTelephone)}
                    aria-describedby={describedBy(
                      "businessTelephone",
                      false,
                      errors.businessTelephone,
                    )}
                    className={inputClassName}
                  />
                </Field>
                <Field
                  id="tenderCategory"
                  label="Tender category"
                  error={errors.tenderCategory}
                >
                  <select
                    id="tenderCategory"
                    name="tenderCategory"
                    value={values.tenderCategory}
                    onChange={updateSelect}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.tenderCategory)}
                    aria-describedby={describedBy(
                      "tenderCategory",
                      false,
                      errors.tenderCategory,
                    )}
                    className={selectClassName}
                  >
                    <option value="">Select a category</option>
                    <option value="federal_public">
                      Nigerian public sector
                    </option>
                    <option value="oil_and_gas">
                      Oil and gas / NipeX / NCDMB
                    </option>
                    <option value="donor_funded">Donor-funded</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field id="bidStage" label="Bid stage" error={errors.bidStage}>
                  <select
                    id="bidStage"
                    name="bidStage"
                    value={values.bidStage}
                    onChange={updateSelect}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.bidStage)}
                    aria-describedby={describedBy(
                      "bidStage",
                      false,
                      errors.bidStage,
                    )}
                    className={selectClassName}
                  >
                    <option value="">Select the current stage</option>
                    <option value="live">Live bid</option>
                    <option value="draft">Draft / planned bid</option>
                    <option value="previously_submitted">
                      Previously submitted
                    </option>
                  </select>
                </Field>
                <Field
                  id="tenderDeadline"
                  label="Tender deadline"
                  hint="Optional. Add it only if a published deadline applies."
                  error={errors.tenderDeadline}
                  required={false}
                >
                  <Input
                    id="tenderDeadline"
                    name="tenderDeadline"
                    type="date"
                    value={values.tenderDeadline}
                    onChange={updateTextField}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.tenderDeadline)}
                    aria-describedby={describedBy(
                      "tenderDeadline",
                      true,
                      errors.tenderDeadline,
                    )}
                    className={inputClassName}
                  />
                </Field>
                <Field
                  id="preferredContactMethod"
                  label="Preferred contact method"
                  error={errors.preferredContactMethod}
                >
                  <select
                    id="preferredContactMethod"
                    name="preferredContactMethod"
                    value={values.preferredContactMethod}
                    onChange={updateSelect}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.preferredContactMethod)}
                    aria-describedby={describedBy(
                      "preferredContactMethod",
                      false,
                      errors.preferredContactMethod,
                    )}
                    className={selectClassName}
                  >
                    <option value="">Select a contact method</option>
                    <option value="email">Email</option>
                    <option value="telephone">Telephone</option>
                  </select>
                </Field>
              </div>

              <div className="sr-only" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  value={values.website}
                  onChange={updateTextField}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <div className="mt-7 border-t border-border pt-6">
                <div className="flex items-start gap-3">
                  <input
                    id="privacyNoticeAcknowledged"
                    name="privacyNoticeAcknowledged"
                    type="checkbox"
                    checked={values.privacyNoticeAcknowledged}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setValues((current) => ({
                        ...current,
                        privacyNoticeAcknowledged: checked,
                      }));
                      setErrors((current) => ({
                        ...current,
                        privacyNoticeAcknowledged: undefined,
                      }));
                      markPayloadChanged();
                    }}
                    disabled={disabled}
                    aria-invalid={Boolean(errors.privacyNoticeAcknowledged)}
                    aria-describedby={
                      errors.privacyNoticeAcknowledged
                        ? "privacyNoticeAcknowledged-error"
                        : undefined
                    }
                    className="mt-1 size-5 shrink-0 accent-primary"
                  />
                  <label
                    htmlFor="privacyNoticeAcknowledged"
                    className="text-sm leading-6"
                  >
                    I have read the{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      privacy notice (opens in a new tab)
                    </Link>{" "}
                    and understand that this public form is only for business
                    contact information. I will not send tender documents or
                    sensitive information here. *
                  </label>
                </div>
                {errors.privacyNoticeAcknowledged ? (
                  <p
                    id="privacyNoticeAcknowledged-error"
                    className="mt-2 text-sm font-medium text-destructive"
                  >
                    {errors.privacyNoticeAcknowledged}
                  </p>
                ) : null}
              </div>

              {submissionState === "error" && submissionError ? (
                <div
                  role="alert"
                  aria-labelledby="bid-autopsy-submit-error-title"
                  className="mt-6 border border-destructive/40 bg-destructive/5 p-4"
                >
                  <h3
                    id="bid-autopsy-submit-error-title"
                    className="font-semibold text-destructive"
                  >
                    {submissionError.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {submissionError.message}
                  </p>
                  {!submissionError.retryable ? (
                    <a
                      href={`${APPROVED_PUBLIC_ORIGIN}/`}
                      className="mt-3 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
                    >
                      Return to Valo
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  size="lg"
                  className="min-h-11"
                  disabled={disabled || retryBlocked}
                >
                  {disabled ? (
                    <>
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                      Sending request...
                    </>
                  ) : retryBlocked ? (
                    "Request unavailable"
                  ) : submissionState === "error" ? (
                    "Try again"
                  ) : (
                    "Request a Bid Autopsy"
                  )}
                </Button>
                <p
                  className="text-xs leading-5 text-muted-foreground"
                  aria-live="polite"
                >
                  {disabled
                    ? "Sending your request. Please keep this page open."
                    : "Your form details are not sent to analytics."}
                </p>
              </div>
            </form>
          )}
        </div>

        <aside
          className="border border-border bg-muted/45 p-5 sm:p-6"
          aria-labelledby="request-boundaries-title"
        >
          <FileLock2 aria-hidden="true" className="size-6 text-primary" />
          <h2
            id="request-boundaries-title"
            className="mt-5 text-xl font-semibold"
          >
            What happens next
          </h2>
          <ul className="mt-5 space-y-5">
            {[
              "Valo records the business contact details it needs to assess your request.",
              "This form does not ask for tender files or sensitive financial schedules.",
              "Valo agrees the work, checks for conflicts and approves a secure sharing process before any documents are shared.",
              "Valo confirms timing only after it understands the review.",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-sm leading-6"
              >
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </PublicShell>
  );
}
