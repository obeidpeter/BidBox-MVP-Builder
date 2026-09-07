import {
  useListClients,
  useCreateClient,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Loader2, Plus, Building2, ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import { DataErrorPanel } from "@/components/platform-states";

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  segment: z.enum(["federal", "nipex_ncdmb", "donor", "other"]),
  sector: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  ndaStatus: z.enum(["pending", "signed", "not_required", "declined"]),
  notes: z.string().optional(),
  decisionMakerConversations: z.coerce.number().int().min(0).optional(),
  juniorConversations: z.coerce.number().int().min(0).optional(),
});

type CreateClientForm = z.infer<typeof createClientSchema>;

export default function Clients() {
  const {
    data: clients,
    isLoading,
    isPending,
    isError,
    isSuccess,
    refetch: retryClients,
  } = useListClients();
  const createClient = useCreateClient();
  const queryClient = useQueryClient();
  const canCreateClient = useOrganisationPermission("client:create");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const form = useForm<CreateClientForm>({
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      name: "",
      segment: "other",
      ndaStatus: "pending",
      sector: "",
      contactName: "",
      contactEmail: "",
      notes: "",
    },
  });

  const onSubmit = (data: CreateClientForm) => {
    createClient.mutate(
      { data },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        },
      },
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif tracking-tight font-semibold">
            Clients
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage client profiles and NDAs.
          </p>
        </div>
        {canCreateClient ? (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                New Client
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Create client</DialogTitle>
                <DialogDescription>Add a client profile.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4 pt-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Company Name</Label>
                  <Input id="name" {...form.register("name")} />
                  {form.formState.errors.name && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="segment">Segment</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue("segment", val as any)
                      }
                      defaultValue={form.getValues("segment")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select segment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="federal">Federal</SelectItem>
                        <SelectItem value="nipex_ncdmb">
                          NIPEX / NCDMB
                        </SelectItem>
                        <SelectItem value="donor">Donor</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ndaStatus">NDA Status</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue("ndaStatus", val as any)
                      }
                      defaultValue={form.getValues("ndaStatus")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="signed">Signed</SelectItem>
                        <SelectItem value="not_required">
                          Not Required
                        </SelectItem>
                        <SelectItem value="declined">Declined</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sector">Sector</Label>
                  <Input
                    id="sector"
                    {...form.register("sector")}
                    placeholder="e.g. Oil & Gas, IT"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="decisionMakerConversations">
                      Decision-maker talks
                    </Label>
                    <Input
                      id="decisionMakerConversations"
                      type="number"
                      min={0}
                      {...form.register("decisionMakerConversations")}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      Owners and managing directors
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="juniorConversations">Junior contacts</Label>
                    <Input
                      id="juniorConversations"
                      type="number"
                      min={0}
                      {...form.register("juniorConversations")}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">
                      Junior bid staff
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Contact Name</Label>
                    <Input id="contactName" {...form.register("contactName")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactEmail">Contact Email</Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      {...form.register("contactEmail")}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createClient.isPending}>
                    {createClient.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Create Client
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading || isPending ? (
          <div className="col-span-full py-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !isSuccess || clients === undefined ? (
          <div className="col-span-full">
            <DataErrorPanel
              title="Client register could not be loaded"
              description="We have not treated this as an empty register. Check your connection and organisation access, then try again."
              onRetry={() => void retryClients()}
            />
          </div>
        ) : clients && clients.length > 0 ? (
          clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="bg-primary/5 p-2 rounded-md">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
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
                  <h3 className="font-serif text-xl font-medium tracking-tight mb-1">
                    {client.name}
                  </h3>
                  <div className="text-sm text-muted-foreground capitalize flex items-center gap-2 mb-4">
                    <span>{client.segment?.replace("_", " ")}</span>
                    {client.sector && (
                      <>
                        <span>&bull;</span>
                        <span>{client.sector}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-auto pt-4 border-t border-border flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {client.projectCount || 0} projects
                    </span>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-card border border-dashed border-border rounded-lg">
            <Building2 className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p>No clients found.</p>
            <p className="text-sm">
              {canCreateClient
                ? "Create your first client to get started."
                : "No client records are available for this organisation."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
