import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ValoMark } from "@/components/valo-mark";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Avoid serialising route data or API payloads into the browser console.
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-5">
        <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center">
          <ValoMark className="mx-auto text-primary" />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Page error
          </p>
          <h1 className="mt-3 text-2xl font-semibold">
            We couldn't show this page
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This display error did not change your records. Reload the page, or
            return to the Valo home page.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Return home</Link>
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
