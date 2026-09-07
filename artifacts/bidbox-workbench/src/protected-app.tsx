import { useEffect } from "react";
import Layout from "@/components/layout";
import { OrganisationProvider } from "@/contexts/organisation-context";
import ProtectedRoutes from "@/protected-routes";
import { applyPrivateDocumentMetadata } from "@/lib/private-document-metadata";

export default function ProtectedApp() {
  useEffect(() => {
    applyPrivateDocumentMetadata("Workspace | Valo");
  }, []);

  return (
    <OrganisationProvider>
      <Layout>
        <ProtectedRoutes />
      </Layout>
    </OrganisationProvider>
  );
}
