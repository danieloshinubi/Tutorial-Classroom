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
