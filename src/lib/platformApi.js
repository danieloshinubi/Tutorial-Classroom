// Data access for the platform console only.
//
// Everything here reads across every tenant, which is exactly why it lives in
// its own file rather than in lib/api.js: nothing a school's own pages import
// should be able to reach these. The database checks
// classroom.is_platform_admin() inside each function regardless.
import { supabase } from "./supabaseClient";

export const amIPlatformAdmin = async () => {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) throw error;
  return Boolean(data);
};

export const fetchOverview = async () => {
  const { data, error } = await supabase.rpc("platform_overview");
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
};

export const fetchTenants = async () => {
  const { data, error } = await supabase.rpc("platform_schools");
  if (error) throw error;
  return data || [];
};

export const fetchTenant = async (schoolId) => {
  const { data, error } = await supabase.rpc("platform_tenant", {
    target_school: schoolId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
};

export const fetchTenantAdmins = async (schoolId) => {
  const { data, error } = await supabase.rpc("platform_tenant_admins", {
    target_school: schoolId,
  });
  if (error) throw error;
  return data || [];
};

export const createTenant = async ({ name, slug, ownerEmail }) => {
  const { data, error } = await supabase.rpc("create_school", {
    school_name: name,
    school_slug: slug,
    owner_email: ownerEmail || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const setTenantActive = async ({ id, isActive }) => {
  const { error } = await supabase
    .from("schools")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw error;
};

export const setTenantPlan = async ({ id, plan }) => {
  const { data, error } = await supabase.rpc("platform_set_plan", {
    target_school: id,
    new_plan: plan,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const PLANS = ["trial", "basic", "standard", "premium"];

/* --------------------------------------------------------------- team access */
export const fetchPlatformAdmins = async () => {
  const { data, error } = await supabase.rpc("platform_list_admins");
  if (error) throw error;
  return data || [];
};

export const addPlatformAdmin = async (email) => {
  const { data, error } = await supabase.rpc("platform_add_admin", { target_email: email });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const removePlatformAdmin = async (userId) => {
  const { error } = await supabase.rpc("platform_remove_admin", { target_user: userId });
  if (error) throw error;
};

/* ------------------------------------------------------------------ audit log */
export const fetchPlatformAuditLog = async ({ schoolId, limit } = {}) => {
  const { data, error } = await supabase.rpc("platform_audit_log", {
    target_school: schoolId || null,
    limit_rows: limit || 100,
  });
  if (error) throw error;
  return data || [];
};

/* --------------------------------------------------------------------- trial */
export const extendTrial = async ({ schoolId, days }) => {
  const { data, error } = await supabase.rpc("platform_extend_trial", {
    target_school: schoolId,
    days,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

/* ------------------------------------------------------------------- gateway */
export const fetchPlatformGateways = async () => {
  const { data, error } = await supabase.rpc("platform_gateways");
  if (error) throw error;
  return data || [];
};

/* ------------------------------------------------------------------ mailboxes */
export const fetchPlatformMailboxHealth = async () => {
  const { data, error } = await supabase.rpc("platform_mailbox_health");
  if (error) throw error;
  return data || [];
};

/* ----------------------------------------------------------------- onboarding */
export const fetchOnboarding = async (schoolId) => {
  const { data, error } = await supabase.rpc("platform_onboarding", { target_school: schoolId });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
};

/* -------------------------------------------------------------------- billing */
export const fetchBillingForSchool = async (schoolId) => {
  const { data, error } = await supabase.rpc("platform_billing_for_school", { target_school: schoolId });
  if (error) throw error;
  return data || [];
};

export const addBillingRecord = async ({ schoolId, plan, amount, currency, periodStart, periodEnd, status, note }) => {
  const { data, error } = await supabase.rpc("platform_add_billing_record", {
    target_school: schoolId,
    plan_in: plan,
    amount_in: amount,
    currency_in: currency,
    period_start_in: periodStart,
    period_end_in: periodEnd,
    status_in: status || "pending",
    note_in: note || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const fetchAllBillingRecords = async () => {
  const { data, error } = await supabase.rpc("platform_billing_records");
  if (error) throw error;
  return data || [];
};

export const setBillingStatus = async ({ recordId, status }) => {
  const { data, error } = await supabase.rpc("platform_set_billing_status", {
    target_record: recordId,
    status_in: status,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const BILLING_STATUSES = ["pending", "paid", "overdue", "waived"];

/* ---------------------------------------------------------------- offboarding */
export const exportSchool = async (schoolId) => {
  const { data, error } = await supabase.rpc("platform_export_school", { target_school: schoolId });
  if (error) throw error;
  return data;
};

export const archiveSchool = async ({ schoolId, archived }) => {
  const { data, error } = await supabase.rpc("platform_archive_school", {
    target_school: schoolId,
    archived,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

/* -------------------------------------------------------------------- search */
export const platformSearch = async (query) => {
  const { data, error } = await supabase.rpc("platform_search", { query });
  if (error) throw error;
  return data || [];
};
