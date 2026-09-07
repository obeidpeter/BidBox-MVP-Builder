import { useLayoutEffect } from "react";
import Layout from "@/components/layout";
import { OrganisationProvider } from "@/contexts/organisation-context";
import ProtectedRoutes from "@/protected-routes";
import { applyPrivateDocumentMetadata } from "@/lib/private-document-metadata";

export default function ProtectedApp() {
  useLayoutEffect(() => {
    // Establish private metadata even while identity or organisation gates are
    // visible. The mounted route manager replaces this generic title with the
    // route-specific title in its passive effect.
    applyPrivateDocumentMetadata("Workspace | BidBox");
  }, []);

  return (
    <OrganisationProvider>
      <Layout>
        <ProtectedRoutes />
      </Layout>
    </OrganisationProvider>
  );
}
