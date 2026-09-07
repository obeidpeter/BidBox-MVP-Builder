export interface CommercialOfferView {
  versionId: string;
  sku: string;
  title: string;
  summary: string;
  cadence: "one_off" | "manual_monthly";
  fixedScope: readonly string[];
  excludedActions: readonly string[];
  humanQuoteRequired: true;
  orderable: boolean;
}

export interface QuoteProposalView {
  id: string;
  projectId: string | null;
  offerVersionId: string;
  customerReference: string;
  scopeSummary: string;
  currency: string;
  amountMinor: number;
  validUntil: string;
  serviceStartsOn: string;
  serviceEndsOn: string;
  serviceUnits: number;
  status: "pending_checker" | "approved" | "invoiced" | "paid";
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
}

export interface CommercialInvoiceView {
  id: string;
  orderId: string;
  invoiceNumber: string;
  currency: string;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  whtAmountMinor: number | null;
  netPayableMinor: number;
  status: "issued_manual" | "paid_manual";
  version: number;
}

export interface CommercialPaymentView {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  status: "evidence_recorded" | "settled";
  reconciliationStatus: "pending_checker" | "verified_manual";
  evidenceSha256: string;
  recordedByUserId: string;
  verifiedByUserId: string | null;
  settledAt: string;
  version: number;
}

export interface CommercialEntitlementView {
  id: string;
  orderId: string;
  productKind: string;
  status: "active" | "scheduled";
  paymentState: "verified_manual";
  startsAt: string;
  endsAt: string;
  usageLimit: number;
  usageConsumed: number;
  version: number;
}

export interface RetainerServiceRequestView {
  id: string;
  projectId: string;
  entitlementId: string;
  purpose: "evidence_review" | "renewal_readiness" | "bid_evidence_pack";
  summary: string;
  ownerMembershipId: string;
  sla: "standard" | "priority";
  slaPolicyVersion: "valo.retainer-sla@v1";
  dueAt: string;
  status:
    | "open"
    | "in_progress"
    | "awaiting_evidence"
    | "completed"
    | "cancelled";
  comments: readonly {
    id: string;
    body: string;
    createdByUserId: string;
    createdAt: string;
  }[];
  evidenceReceipts: readonly {
    id: string;
    reference: string;
    sha256: string;
    recordedByUserId: string;
    recordedAt: string;
  }[];
  version: number;
}

export interface CommercialRetainerSnapshotView {
  organisationId: string;
  manifest: {
    moduleVersion: string;
    routeMounted: boolean;
    navigationMounted: boolean;
    openApiPublished: boolean;
    automaticPricingAllowed: boolean;
    paymentProviderConnected: boolean;
    externalMessagingConnected: boolean;
    autonomousWorkAllowed: boolean;
    makerCheckerRequired: boolean;
  };
  activation: {
    fixedPriceBookReady: boolean;
    providerConnected: false;
    manualReconciliationReady: boolean;
    retainerDeskReady: boolean;
  };
  offers: readonly CommercialOfferView[];
  quotes: readonly QuoteProposalView[];
  invoices: readonly CommercialInvoiceView[];
  payments: readonly CommercialPaymentView[];
  entitlements: readonly CommercialEntitlementView[];
  serviceRequests: readonly RetainerServiceRequestView[];
}

export interface CommercialRetainerMutation {
  path: string;
  body: Record<string, unknown>;
}
