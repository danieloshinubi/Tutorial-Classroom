import { render, screen } from "@testing-library/react";
import App from "./App";

// Supabase is not reachable in the test environment, so stub the client and
// let the app fall through to its signed-out state.
jest.mock("./lib/supabaseClient", () => {
  // Chainable stub: every builder method returns itself, and awaiting it
  // resolves to an empty, error-free result.
  const query = {};
  ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"].forEach(
    (method) => {
      query[method] = () => query;
    }
  );
  query.maybeSingle = () => Promise.resolve({ data: null, error: null });
  query.single = () => Promise.resolve({ data: null, error: null });
  query.then = (resolve) => resolve({ data: [], error: null });

  return {
    isSupabaseConfigured: true,
    // No third-party providers in tests, so the Google button stays hidden.
    fetchEnabledProviders: () => Promise.resolve({}),
    supabase: {
      from: () => query,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    },
  };
});

// getByRole is avoided throughout: react-scripts 5 ships a jsdom whose
// selector engine rejects the queries testing-library builds for it.
test("shows the login page when nobody is signed in", async () => {
  render(<App />);

  expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByText(/forgot password\?/i)).toBeInTheDocument();
  expect(screen.getByText(/sign up/i)).toBeInTheDocument();
});
