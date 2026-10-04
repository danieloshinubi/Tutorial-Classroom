import { db, fail, type Fn } from "./db";

// Schoolivio staff access to a school (supabase/224). Console accounts are
// either approved school by school, for a set time, or break-glass. Every
// decision is enforced in the database; these are its calls.

export type AccessMode = "approval" | "breakglass";

export interface PlatformAccess {
  state: "not_platform" | "no_school" | "member" | "granted" | "pending" | "none";
  mode?: AccessMode;
  school_name?: string;
  expires_at?: string;
  requested_at?: string;
  reason?: string;
  last_status?: "pending" | "approved" | "declined" | "cancelled" | "ended" | null;
  last_note?: string | null;
  last_at?: string | null;
}

export type AccessRequest = Fn<"school_access_requests">["Returns"][number];

export interface GrantedMember {
  id: string;
  user_id: string;
  access_expires_at: string;
  granted_via: "platform_breakglass" | "platform_approved";
  profiles: { first_name: string | null; surname: string | null; email: string | null } | null;
}

// Where a console account stands with this school. For a break-glass
// account this also lets them in.
export const platformSchoolAccess = async (slug: string): Promise<PlatformAccess> => {
  const { data, error } = await db.rpc("platform_school_access", { target_slug: slug });
  if (error) fail(error, "Could not check your access to this school.");
  return (data || { state: "none" }) as unknown as PlatformAccess;
};

export const requestSchoolAccess = async (slug: string, reason: string): Promise<void> => {
  const { error } = await db.rpc("request_school_access", { target_slug: slug, reason });
  if (error) fail(error, "Could not send the request.");
};

export const cancelSchoolAccessRequest = async (slug: string): Promise<void> => {
  const { error } = await db.rpc("cancel_school_access_request", { target_slug: slug });
  if (error) fail(error, "Could not cancel the request.");
};

export const decideSchoolAccess = async (requestId: string, approve: boolean, hours: number | null, note?: string): Promise<void> => {
  const args = { target_request: requestId, approve, hours_in: hours ?? 0, note: note ?? null };
  const { error } = await db.rpc("decide_school_access", args as unknown as Parameters<typeof db.rpc<"decide_school_access">>[1]);
  if (error) fail(error, "Could not save that decision.");
};

export const endSchoolAccess = async (schoolId: string, userId: string): Promise<void> => {
  const { error } = await db.rpc("end_school_access", { target_school: schoolId, target_user: userId });
  if (error) fail(error, "Could not end that access.");
};

export const fetchAccessRequests = async (schoolId: string): Promise<AccessRequest[]> => {
  const { data, error } = await db.rpc("school_access_requests", { target_school: schoolId });
  if (error) fail(error, "Could not load requests.");
  return data || [];
};

export const fetchGrantedMembers = async (schoolId: string): Promise<GrantedMember[]> => {
  const { data, error } = await db
    .from("school_members")
    .select("id, user_id, access_expires_at, granted_via, profiles!school_members_user_id_fkey ( first_name, surname, email )")
    .eq("school_id", schoolId)
    .not("granted_via", "is", null)
    .order("access_expires_at");
  if (error) fail(error, "Could not load who has access.");
  return (data || []) as unknown as GrantedMember[];
};

// Console: an account's type (never your own).
export const setPlatformAccessType = async (userId: string, type: AccessMode): Promise<void> => {
  const { error } = await db.rpc("platform_set_access_type", { target_user: userId, type_in: type });
  if (error) fail(error, "Could not change that.");
};

export const ACCESS_LABEL: Record<AccessMode, string> = {
  approval: "Needs each school's approval",
  breakglass: "Break-glass: any school, any time",
};
