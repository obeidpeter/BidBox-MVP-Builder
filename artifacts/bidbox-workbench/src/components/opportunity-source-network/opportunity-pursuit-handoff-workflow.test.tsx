import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  CANDIDATE_ID,
  ORGANISATION_ID,
  readyHandoffResponse,
} from "./opportunity-pursuit-handoff-contract.test";
import { OpportunityPursuitHandoffWorkflow } from "./opportunity-pursuit-handoff-workflow";

const customFetch = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({ customFetch }));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: "11111111-1111-4111-8111-111111111111",
      membershipId: "membership-1",
    },
    effectivePermissions: ["project:create"],
    beginCriticalWorkflow: () => vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  customFetch.mockReset();
  customFetch.mockImplementation((_url: string, init?: { method?: string }) =>
    init?.method === "POST"
      ? Promise.reject(new Error("version conflict"))
      : Promise.resolve(readyHandoffResponse()),
  );
});

it("keeps rejected confirmation UI and reuses the exact idempotency digest", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <OpportunityPursuitHandoffWorkflow
        organisationId={ORGANISATION_ID}
        candidateId={CANDIDATE_ID}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(
    screen.getByRole("button", { name: /prepare pursuit handoff/i }),
  );
  const submit = await screen.findByRole("button", {
    name: /create intake pursuit only/i,
  });
  const note = screen.getByLabelText(/confirmation note/i);
  fireEvent.change(note, {
    target: { value: "Reopened and checked the accepted source." },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);

  expect(
    await screen.findByRole("heading", {
      name: /pursuit handoff was not recorded/i,
    }),
  ).toBeInTheDocument();
  expect(note).toHaveValue("Reopened and checked the accepted source.");
  expect(screen.getByRole("checkbox")).toBeChecked();

  const postCalls = () =>
    customFetch.mock.calls.filter(
      ([, init]) =>
        (init as { method?: string } | undefined)?.method === "POST",
    );
  expect(postCalls()).toHaveLength(1);
  const firstKey = (
    postCalls()[0]?.[1] as { headers?: Record<string, string> } | undefined
  )?.headers?.["Idempotency-Key"];
  expect(firstKey).toBeTruthy();

  fireEvent.click(submit);
  await waitFor(() => expect(postCalls()).toHaveLength(2));
  const secondKey = (
    postCalls()[1]?.[1] as { headers?: Record<string, string> } | undefined
  )?.headers?.["Idempotency-Key"];
  expect(secondKey).toBe(firstKey);
});
