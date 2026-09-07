import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function ValoUserIdCard({ userId }: { userId: string }) {
  const { toast } = useToast();

  const copyUserId = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable");
      }
      await navigator.clipboard.writeText(userId);
      toast({ title: "Valo user ID copied" });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not copy Valo user ID",
        description: "Select and copy the identifier manually.",
      });
    }
  };

  return (
    <section
      aria-label="Valo user ID"
      className="rounded-lg border border-border bg-card p-5 text-left"
    >
      <h2 className="text-sm font-semibold">Valo user ID</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Share this internal account identifier with an authorised organisation
        administrator when they add you to a Valo workspace. It is not your
        email address or Clerk sign-in ID.
      </p>
      <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-2">
        <code className="min-w-0 flex-1 break-all text-xs">{userId}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Copy Valo user ID"
          onClick={() => void copyUserId()}
        >
          <Copy aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}
