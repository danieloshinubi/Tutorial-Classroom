// Types for AuthContext.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export interface AuthValue {
  session: unknown;
  user: ({ id: string; email?: string } & Record<string, unknown>) | null;
  profile: ({ id: string; must_change_password?: boolean | null; first_name?: string | null; surname?: string | null; email?: string | null } & Record<string, unknown>) | null;
  loading: boolean;
  sessionReady: boolean;
  signOut: () => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signUp: (args: {
    email: string;
    password: string;
    firstName: string;
    surname: string;
    username?: string;
    role?: string;
    pendingApplicantSchoolId?: string;
  }) => Promise<{ session: unknown | null; user?: unknown }>;
  signIn: (args: { email: string; password: string }) => Promise<unknown>;
  [key: string]: unknown;
}
export declare const useAuth: () => AuthValue;
export declare const AuthProvider: (p: { children?: ReactNode }) => JSX.Element;
