import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
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

export function FieldErrorMessage({
  id,
  children,
}: {
  id: string;
  children?: ReactNode;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}

export function FormErrorSummary({
  id,
  errors,
  title = "Check the highlighted fields",
}: {
  id: string;
  errors: Array<string | undefined | null>;
  title?: string;
}) {
  const uniqueErrors = [...new Set(errors.filter(Boolean))] as string[];
  if (uniqueErrors.length === 0) return null;
  return (
    <section
      id={id}
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
        <div>
          <p className="font-medium text-destructive">{title}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {uniqueErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function UnsavedChangesAlert({
  open,
  onOpenChange,
  onDiscard,
  subject = "this form",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  subject?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes to {subject} have not been saved. Keep editing to
            preserve them, or discard them and close the form.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscard}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
