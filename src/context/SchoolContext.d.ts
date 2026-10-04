// Types for SchoolContext.jsx, so TypeScript screens get real checking while it is
// still JavaScript. Keep in step with it; delete this file when it becomes
// .tsx.
import type { ReactNode } from "react";

export interface SchoolValue {
  slug: string;
  school: ({ id: string; name: string; slug: string; currency?: string | null } & Record<string, unknown>) | null;
  schoolId: string | null;
  levels: { year: number; label: string }[];
  labelFor: (year: number | string) => string;
  disabledModules: string[];
  moduleGrants: Record<string, "read" | "edit">;
  /** A console account not (yet) let into this school; null otherwise. */
  platformAccess: import("../lib/schoolAccessApi").PlatformAccess | null;
  membership: { id: string; role: string; is_active: boolean; access_expires_at: string | null; granted_via: string | null } | null;
  role: string | null;
  roles: string[];
  isAdmin: boolean;
  isPrincipal: boolean;
  isBursar: boolean;
  isStaff: boolean;
  isTeacher: boolean;
  isParent: boolean;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}
export declare const useSchool: () => SchoolValue;
export declare const useSchoolIfAny: () => SchoolValue | null;
export declare const useModuleAccess: (moduleId: string) => { access: "edit" | "read" | null; canEdit: boolean; readOnly: boolean };
export declare const SchoolProvider: (p: { children?: ReactNode }) => JSX.Element;
declare const SchoolContext: unknown;
export default SchoolContext;
