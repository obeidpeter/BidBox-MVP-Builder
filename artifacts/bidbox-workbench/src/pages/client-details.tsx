import {
  useGetClient,
  useUpdateClient,
  useListProjects,
  getGetClientQueryKey,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Loader2, Building2, Mail, User, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClientVault } from "@/components/client-vault";
import { ClientCapability } from "@/components/client-capability";
import { useOrganisationPermission } from "@/contexts/organisation-context";

export default function ClientDetails() {
  const canUpdateClient = useOrganisationPermission("client:update");
  const canCreateProject = useOrganisationPermission("project:create");
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading: loadingClient } = useGetClient(id);
  const { data: projects, isLoading: loadingProjects } = useListProjects({
    clientId: id,
  });
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<any>({});

  if (loadingClient) {
    return (
      <div className="p-8 flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center">
        <h1 className="text-2xl font-serif text-destructive">
          Client not found
        </h1>
      </div>
    );
  }

  const handleEdit = () => {
    setFormData({
      name: client.name,
      segment: client.segment,
      sector: client.sector,
      ndaStatus: client.ndaStatus,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
      notes: client.notes,
      decisionMakerConversations: client.decisionMakerConversations ?? 0,
      juniorConversations: client.juniorConversations ?? 0,
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    const data = {
      ...formData,
      decisionMakerConversations: Number(
        formData.decisionMakerConversations ?? 0,
      ),
      juniorConversations: Number(formData.juniorConversations ?? 0),
    };
    updateClient.mutate(
      { id, data },
      {
        onSuccess: () => {
          setIsEditing(false);
          queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        },
      },
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-serif tracking-tight font-semibold">
              {client.name}
            </h1>
            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <span className="capitalize">
                {client.segment?.replace("_", " ")}
              </span>
              {client.sector && (
                <>
                  <span>&bull;</span>
                  <span>{client.sector}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canUpdateClient && isEditing ? (
            <>
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={updateClient.isPending}>
                {updateClient.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </>
          ) : canUpdateClient ? (
            <Button variant="outline" onClick={handleEdit}>
              Edit Profile
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-xs">
          <CardHeader>
            <CardTitle className="text-lg font-serif">
              Profile Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {canUpdateClient && isEditing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Company Name
                  </label>
                  <Input
                    value={formData.name || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Sector
                  </label>
                  <Input
                    value={formData.sector || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, sector: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Segment
                  </label>
                  <Select
                    value={formData.segment || ""}
                    onValueChange={(val) =>
                      setFormData({ ...formData, segment: val })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="federal">Federal</SelectItem>
                      <SelectItem value="nipex_ncdmb">NIPEX / NCDMB</SelectItem>
                      <SelectItem value="donor">Donor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    NDA Status
                  </label>
                  <Select
                    value={formData.ndaStatus || ""}
                    onValueChange={(val) =>
                      setFormData({ ...formData, ndaStatus: val })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="signed">Signed</SelectItem>
                      <SelectItem value="not_required">Not Required</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Decision-maker Talks
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.decisionMakerConversations ?? 0}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        decisionMakerConversations: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Owners / managing directors — initial readiness measure
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Junior Contacts
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.juniorConversations ?? 0}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        juniorConversations: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Junior bid staff
                  </p>
                </div>
                <div className="col-span-1 md:col-span-2 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Notes
                  </label>
                  <Textarea
                    value={formData.notes || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    className="min-h-[100px]"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-4">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Company Name
                  </h3>
                  <p className="font-medium">{client.name}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Sector
                  </h3>
                  <p className="font-medium">{client.sector || "-"}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Segment
                  </h3>
                  <p className="font-medium capitalize">
                    {client.segment?.replace("_", " ") || "-"}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    NDA Status
                  </h3>
                  <Badge
                    variant={
                      client.ndaStatus === "signed"
                        ? "default"
                        : client.ndaStatus === "pending"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {client.ndaStatus.replace("_", " ")}
                  </Badge>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Decision-maker Talks
                  </h3>
                  <p className="font-medium">
                    {client.decisionMakerConversations ?? 0}
                    <span className="text-xs text-muted-foreground font-normal">
                      {" "}
                      owners / MDs
                    </span>
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Junior Contacts
                  </h3>
                  <p className="font-medium">
                    {client.juniorConversations ?? 0}
                    <span className="text-xs text-muted-foreground font-normal">
                      {" "}
                      junior bid staff
                    </span>
                  </p>
                </div>
                <div className="col-span-1 md:col-span-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">
                    {client.notes || "No notes available."}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-lg font-serif">Contact Info</CardTitle>
          </CardHeader>
          <CardContent>
            {canUpdateClient && isEditing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Contact Name
                  </label>
                  <Input
                    value={formData.contactName || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, contactName: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Contact Email
                  </label>
                  <Input
                    type="email"
                    value={formData.contactEmail || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, contactEmail: e.target.value })
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Primary Contact
                    </h3>
                    <p className="font-medium">
                      {client.contactName || "Not specified"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Email Address
                    </h3>
                    <p className="font-medium">
                      {client.contactEmail || "Not specified"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3">
          <ClientVault clientId={client.id} />
        </div>

        <div className="lg:col-span-3">
          <ClientCapability clientId={client.id} />
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif tracking-tight font-medium">
              Projects for {client.name}
            </h2>
            {canCreateProject && (
              <Link href={`/projects?clientId=${client.id}`}>
                <Button size="sm" variant="outline">
                  <Briefcase className="w-4 h-4 mr-2" />
                  New Project
                </Button>
              </Link>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
            {loadingProjects ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects && projects.length > 0 ? (
              <div className="divide-y divide-border">
                {projects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {project.tenderTitle}
                        </div>
                        <div className="text-sm text-muted-foreground capitalize mt-1">
                          {project.status.replace("_", " ")}
                        </div>
                      </div>
                      <Badge variant="outline">
                        {project.riskBand || "Unknown Risk"}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No projects found for this client.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
