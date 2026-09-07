import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

interface DestructiveConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
}

/**
 * Confirmation for irreversible server mutations. The action prevents Radix
 * from auto-closing: callers close it only after the server confirms success,
 * keeping pending and failure feedback attached to the decision.
 */
export function DestructiveConfirmation({
  open,
  onOpenChange,
  itemName,
  title,
  consequence,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
}: DestructiveConfirmationProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p className="font-medium text-foreground">“{itemName}”</p>
              <p>{consequence}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            aria-busy={pending}
            aria-live="polite"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              if (!pending) onConfirm();
            }}
          >
            {pending ? (
              <>
                <Loader2
                  aria-hidden="true"
                  className="mr-2 size-4 animate-spin motion-reduce:animate-none"
                />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
