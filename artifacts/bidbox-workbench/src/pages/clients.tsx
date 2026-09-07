import {
  useListClients,
  useCreateClient,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { type FieldErrors, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganisationPermission } from "@/contexts/organisation-context";
import { DataErrorPanel, LoadingPanel } from "@/components/platform-states";
import {
  FieldErrorMessage,
  FormErrorSummary,
  UnsavedChangesAlert,
} from "@/components/form-feedback";
import { errorMessage } from "@/lib/errors";
import { useToast } from "@/hooks/use-toast";

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  segment: z.enum(["federal", "nipex_ncdmb", "donor", "other"]),
  sector: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z
    .string()
    .email("Enter a valid contact email address")
    .optional()
    .or(z.literal("")),
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
  const { toast } = useToast();
  const canCreateClient = useOrganisationPermission("client:create");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    setSubmitError(null);
    createClient.mutate(
      { data },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
          form.reset();
          toast({
            title: "Client created",
            description: `${data.name} is now available in the client register.`,
          });
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        },
        onError: (error) => {
          setSubmitError(
            errorMessage(
              error,
              "The client could not be created. Your entered details are still here; check your access and try again.",
            ),
          );
        },
      },
    );
  };

  const validationMessages = Object.values(form.formState.errors)
    .map((fieldError) => fieldError?.message)
    .filter((message): message is string => typeof message === "string");
  const formIsDirty = form.formState.isDirty;

  const handleInvalid = (errors: FieldErrors<CreateClientForm>) => {
    setSubmitError(null);
    const firstInvalid = [
      "name",
      "segment",
      "ndaStatus",
      "sector",
      "decisionMakerConversations",
      "juniorConversations",
      "contactName",
      "contactEmail",
      "notes",
    ].find((field) => errors[field as keyof CreateClientForm]);
    if (firstInvalid) {
      form.setFocus(firstInvalid as keyof CreateClientForm);
    }
  };

  const closeCreateForm = () => {
    setSubmitError(null);
    setDiscardOpen(false);
    setIsCreateOpen(false);
    form.reset();
  };

  const requestCreateOpenChange = (open: boolean) => {
    if (open) {
      setIsCreateOpen(true);
      return;
    }
    if (createClient.isPending) return;
    if (formIsDirty) {
      setDiscardOpen(true);
      return;
    }
    closeCreateForm();
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
          <Dialog open={isCreateOpen} onOpenChange={requestCreateOpenChange}>
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
                noValidate
                onSubmit={form.handleSubmit(onSubmit, handleInvalid)}
                aria-describedby={
                  validationMessages.length > 0 || submitError
                    ? "create-client-errors"
                    : undefined
                }
                className="space-y-4 pt-4"
              >
                <FormErrorSummary
                  id="create-client-errors"
                  title={
                    submitError
                      ? "Client was not created"
                      : "Check the highlighted client details"
                  }
                  errors={[submitError, ...validationMessages]}
                />
                <div className="space-y-2">
                  <Label htmlFor="client-name">Company name</Label>
                  <Input
                    id="client-name"
                    aria-invalid={Boolean(form.formState.errors.name)}
                    aria-describedby={
                      form.formState.errors.name
                        ? "client-name-error"
                        : undefined
                    }
                    {...form.register("name")}
                  />
                  <FieldErrorMessage id="client-name-error">
                    {form.formState.errors.name?.message}
                  </FieldErrorMessage>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-segment">Segment</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue(
                          "segment",
                          val as CreateClientForm["segment"],
                          {
                            shouldDirty: true,
                            shouldValidate: true,
                          },
                        )
                      }
                      value={form.watch("segment")}
                    >
                      <SelectTrigger id="client-segment">
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
                    <Label htmlFor="client-nda-status">NDA status</Label>
                    <Select
                      onValueChange={(val) =>
                        form.setValue(
                          "ndaStatus",
                          val as CreateClientForm["ndaStatus"],
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                      value={form.watch("ndaStatus")}
                    >
                      <SelectTrigger id="client-nda-status">
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
                  <Label htmlFor="client-sector">Sector</Label>
                  <Input
                    id="client-sector"
                    {...form.register("sector")}
                    placeholder="e.g. Oil & Gas, IT"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-decision-maker-conversations">
                      Decision-maker talks
                    </Label>
                    <Input
                      id="client-decision-maker-conversations"
                      type="number"
                      min={0}
                      aria-invalid={Boolean(
                        form.formState.errors.decisionMakerConversations,
                      )}
                      aria-describedby={
                        form.formState.errors.decisionMakerConversations
                          ? "client-decision-maker-help client-decision-maker-error"
                          : "client-decision-maker-help"
                      }
                      {...form.register("decisionMakerConversations")}
                      placeholder="0"
                    />
                    <p
                      id="client-decision-maker-help"
                      className="text-xs text-muted-foreground"
                    >
                      Owners and managing directors
                    </p>
                    <FieldErrorMessage id="client-decision-maker-error">
                      {
                        form.formState.errors.decisionMakerConversations
                          ?.message
                      }
                    </FieldErrorMessage>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-junior-conversations">
                      Junior contacts
                    </Label>
                    <Input
                      id="client-junior-conversations"
                      type="number"
                      min={0}
                      aria-invalid={Boolean(
                        form.formState.errors.juniorConversations,
                      )}
                      aria-describedby={
                        form.formState.errors.juniorConversations
                          ? "client-junior-help client-junior-error"
                          : "client-junior-help"
                      }
                      {...form.register("juniorConversations")}
                      placeholder="0"
                    />
                    <p
                      id="client-junior-help"
                      className="text-xs text-muted-foreground"
                    >
                      Junior bid staff
                    </p>
                    <FieldErrorMessage id="client-junior-error">
                      {form.formState.errors.juniorConversations?.message}
                    </FieldErrorMessage>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-contact-name">Contact name</Label>
                    <Input
                      id="client-contact-name"
                      {...form.register("contactName")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-contact-email">Contact email</Label>
                    <Input
                      id="client-contact-email"
                      type="email"
                      aria-invalid={Boolean(form.formState.errors.contactEmail)}
                      aria-describedby={
                        form.formState.errors.contactEmail
                          ? "client-contact-email-error"
                          : undefined
                      }
                      {...form.register("contactEmail")}
                    />
                    <FieldErrorMessage id="client-contact-email-error">
                      {form.formState.errors.contactEmail?.message}
                    </FieldErrorMessage>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-notes">Notes</Label>
                  <Textarea
                    id="client-notes"
                    rows={3}
                    {...form.register("notes")}
                    placeholder="Optional context for the client team"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={createClient.isPending}
                    onClick={() => requestCreateOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createClient.isPending}>
                    {createClient.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    {createClient.isPending
                      ? "Creating client"
                      : "Create client"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <UnsavedChangesAlert
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={closeCreateForm}
        subject="this client profile"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading || isPending ? (
          <div className="col-span-full">
            <LoadingPanel label="Loading client register" />
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
