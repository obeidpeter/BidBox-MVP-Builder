import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import RequireAdmin from "@/components/require-admin";
import RequireArea from "@/components/require-area";
import { LoadingPanel } from "@/components/platform-states";
import { platformFeatureFlags } from "@/lib/platform-access";
import { ProtectedRouteAccessibility } from "@/components/protected-route-accessibility";

const RoleHome = lazy(() => import("@/components/role-home"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Clients = lazy(() => import("@/pages/clients"));
const ClientDetails = lazy(() => import("@/pages/client-details"));
const Projects = lazy(() => import("@/pages/projects"));
const ProjectDetails = lazy(() => import("@/pages/project-details"));
const TenderContext = lazy(() => import("@/pages/tender-context-route"));
const SbdCorpus = lazy(() => import("@/pages/sbd"));
const SbdDetails = lazy(() => import("@/pages/sbd-details"));
const Settings = lazy(() => import("@/pages/settings"));
const ClientPortal = lazy(() => import("@/pages/client-portal"));
const OperationsConsole = lazy(() => import("@/pages/operations-console"));
const PursuitOperationsSuite = lazy(
  () => import("@/pages/pursuit-operations-suite-route"),
);
const GrowthOperations = lazy(() => import("@/pages/growth-operations"));
const OpportunitySourceNetwork = lazy(
  () => import("@/pages/opportunity-source-network"),
);
const ClientActionPortal = lazy(
  () => import("@/pages/client-action-portal-route"),
);
const ProductionAcceptance = lazy(
  () => import("@/pages/production-acceptance"),
);
const AiShadowProgramme = lazy(() => import("@/pages/ai-shadow-programme"));
const EncryptedFieldCompanion = lazy(
  () => import("@/pages/encrypted-field-companion"),
);
const ReconciledCommunications = lazy(
  () => import("@/pages/reconciled-communications-route"),
);
const PrivacyOperations = lazy(() => import("@/pages/privacy-operations"));
const IntelligenceCentre = lazy(
  () => import("@/pages/intelligence-centre-route"),
);
const PortfolioIntelligence = lazy(
  () => import("@/pages/portfolio-intelligence"),
);
const PartnerWorkspace = lazy(() => import("@/pages/partner-workspace"));
const PartnerConsortiumRoom = lazy(
  () => import("@/pages/partner-consortium-room-route"),
);
const BillingEntitlements = lazy(() => import("@/pages/billing-entitlements"));
const CommercialRetainer = lazy(() => import("@/pages/commercial-retainer"));
const ClaimsDesk = lazy(() => import("@/pages/claims-desk"));
const NotificationsConsole = lazy(
  () => import("@/pages/notifications-console"),
);
const SecurityAudit = lazy(() => import("@/pages/security-audit"));
const EvidenceReadiness = lazy(() => import("@/pages/evidence-readiness"));
const EvidenceRenewal = lazy(() => import("@/pages/evidence-renewal"));
const ReportsIndex = lazy(() => import("@/pages/reports-index"));
const AccountPage = lazy(() => import("@/pages/account"));
const HelpPage = lazy(() => import("@/pages/help"));
const OrganisationSettings = lazy(
  () => import("@/pages/organisation-settings"),
);

export default function ProtectedRoutes() {
  const partnerWorkspaceEnabled = platformFeatureFlags().partnerWorkspace;
  return (
    <Suspense
      fallback={
        <div className="p-6 sm:p-8">
          <LoadingPanel label="Loading workspace view" />
        </div>
      }
    >
      <ProtectedRouteAccessibility />
      <Switch>
        <Route path="/app" component={RoleHome} />
        <Route path="/dashboard" component={RoleHome} />
        <Route path="/clients">
          <RequireArea area="pursuit_workbench">
            <Clients />
          </RequireArea>
        </Route>
        <Route path="/clients/:id">
          <RequireArea area="pursuit_workbench">
            <ClientDetails />
          </RequireArea>
        </Route>
        <Route path="/projects">
          <RequireArea area="pursuit_workbench">
            <Projects />
          </RequireArea>
        </Route>
        <Route path="/projects/:id/tender-context">
          <RequireArea area="pursuit_workbench">
            <TenderContext />
          </RequireArea>
        </Route>
        <Route path="/projects/:id">
          <RequireArea area="pursuit_workbench">
            <ProjectDetails />
          </RequireArea>
        </Route>
        <Route path="/sbd">
          <RequireArea area="pursuit_workbench">
            <SbdCorpus />
          </RequireArea>
        </Route>
        <Route path="/sbd/:id">
          <RequireArea area="pursuit_workbench">
            <SbdDetails />
          </RequireArea>
        </Route>
        <Route path="/operations">
          <RequireArea area="operations">
            <OperationsConsole />
          </RequireArea>
        </Route>
        <Route path="/pursuit-operations">
          <RequireArea area="pursuit_operations">
            <PursuitOperationsSuite />
          </RequireArea>
        </Route>
        <Route path="/field-companion">
          <RequireArea area="field_companion">
            <EncryptedFieldCompanion />
          </RequireArea>
        </Route>
        <Route path="/growth-operations">
          <RequireArea area="growth_operations">
            <GrowthOperations />
          </RequireArea>
        </Route>
        <Route path="/opportunity-sources">
          <RequireArea area="opportunity_sources">
            <OpportunitySourceNetwork />
          </RequireArea>
        </Route>
        <Route path="/intelligence">
          <RequireArea area="pursuit_workbench">
            <IntelligenceCentre />
          </RequireArea>
        </Route>
        <Route path="/portfolio-intelligence">
          <RequireArea area="portfolio_intelligence">
            <PortfolioIntelligence />
          </RequireArea>
        </Route>
        <Route path="/portal">
          <RequireArea area="client_portal">
            <ClientPortal />
          </RequireArea>
        </Route>
        <Route path="/client-actions">
          <RequireArea area="client_actions">
            <ClientActionPortal />
          </RequireArea>
        </Route>
        <Route path="/partner">
          <RequireArea area="partner_workspace">
            <PartnerWorkspace />
          </RequireArea>
        </Route>
        <Route path="/consortium-room">
          <RequireArea area="partner_workspace">
            {partnerWorkspaceEnabled ? (
              <PartnerConsortiumRoom />
            ) : (
              <PartnerWorkspace />
            )}
          </RequireArea>
        </Route>
        <Route path="/evidence-readiness">
          <RequireArea area="evidence_readiness">
            <EvidenceReadiness />
          </RequireArea>
        </Route>
        <Route path="/evidence-renewals">
          <RequireArea area="evidence_readiness">
            <EvidenceRenewal />
          </RequireArea>
        </Route>
        <Route path="/reports">
          <RequireArea area="pursuit_workbench">
            <ReportsIndex />
          </RequireArea>
        </Route>
        <Route path="/billing">
          <RequireArea area="billing_entitlements">
            <BillingEntitlements />
          </RequireArea>
        </Route>
        <Route path="/commercial-retainer">
          <RequireArea area="commercial_retainer">
            <CommercialRetainer />
          </RequireArea>
        </Route>
        <Route path="/claims-desk">
          <RequireArea area="claims_desk">
            <ClaimsDesk />
          </RequireArea>
        </Route>
        <Route path="/notifications">
          <RequireArea area="notifications">
            <NotificationsConsole />
          </RequireArea>
        </Route>
        <Route path="/communications">
          <RequireArea area="communications">
            <ReconciledCommunications />
          </RequireArea>
        </Route>
        <Route path="/app/security">
          <RequireArea area="security_audit">
            <SecurityAudit />
          </RequireArea>
        </Route>
        <Route path="/privacy-operations">
          <RequireArea area="privacy_operations">
            <PrivacyOperations />
          </RequireArea>
        </Route>
        <Route path="/production-acceptance">
          <RequireArea area="production_acceptance">
            <ProductionAcceptance />
          </RequireArea>
        </Route>
        <Route path="/ai-shadow">
          <RequireArea area="ai_shadow">
            <AiShadowProgramme />
          </RequireArea>
        </Route>
        <Route path="/organisation-settings">
          <RequireArea area="organisation_settings">
            <OrganisationSettings />
          </RequireArea>
        </Route>
        <Route path="/settings">
          <RequireAdmin>
            <Settings />
          </RequireAdmin>
        </Route>
        <Route path="/account" component={AccountPage} />
        <Route path="/help" component={HelpPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
