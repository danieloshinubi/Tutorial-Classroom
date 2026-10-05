import { db } from "../../../lib/db";

// Shapes and small lookups shared by School admin → People's list and the
// person panel that slides in from the right (PeopleSection, PersonPanel).

export interface PersonProfile {
  id: string;
  first_name: string | null;
  surname: string | null;
  username: string | null;
  email: string | null;
  bio?: string | null;
  avatar_url: string | null;
}

export interface Member {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  manager_id: string | null;
  job_title: string | null;
  access_expires_at: string | null;
  granted_via: string | null;
  profiles: PersonProfile;
}

/** { user_id: { module: "none" | "read" | "edit" } } */
export type Grants = Record<string, Record<string, string>>;

export interface Registration {
  id: string;
  registration_number: string | null;
  status: string | null;
  registered_at: string | null;
  application_id: string | null;
  class: { name: string } | null;
}

/** A pupil's registration at this school, if they have one. */
export const fetchRegistrationOf = async (schoolId: string, studentId: string): Promise<Registration | null> => {
  const { data } = await db
    .from("student_registrations")
    .select("id, registration_number, status, registered_at, application_id, class:classes(name)")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("registered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as Registration) || null;
};

export const ACCESS_WORD: Record<string, string> = { none: "No access", read: "View only", edit: "Can edit" };
