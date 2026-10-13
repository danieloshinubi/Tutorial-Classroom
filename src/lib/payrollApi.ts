import { db, fail } from "./db";

// Payroll figures worked out by the database's own payroll calculation
// (supabase/257), so what the staff form shows is what a payroll run pays.

export interface PayBreakdown {
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number; before_tax: boolean }[];
  gross: number;
  pension_employee: number;
  pension_employer: number;
  nhf: number;
  rent_relief: number;
  taxable_annual: number;
  paye: number;
  other_deductions: number;
  net: number;
}

export interface PayFigures {
  basic: number;
  housing: number;
  transport: number;
  other_allowances: { label: string; amount: number }[];
  pension_applies: boolean;
  nhf_applies: boolean;
  annual_rent: number;
}

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = db.rpc as unknown as Rpc;

/** A full month's pay for the figures on screen (a saved person's own deductions included). */
export const previewPay = async (schoolId: string, staffId: string | null, figures: PayFigures): Promise<PayBreakdown> => {
  const { data, error } = await rpc("payroll_preview", { target_school: schoolId, target_staff: staffId, figures });
  if (error) fail(error as never, "Could not work out the pay.");
  return data as PayBreakdown;
};

/** Gross and net a month for every staff member. */
export const staffPay = async (schoolId: string): Promise<Record<string, { gross: number; net: number }>> => {
  const { data, error } = await rpc("payroll_staff_pay", { target_school: schoolId });
  if (error) fail(error as never, "Could not work out the staff's pay.");
  const out: Record<string, { gross: number; net: number }> = {};
  ((data as { staff_id: string; gross: number; net: number }[] | null) || []).forEach((r) => {
    out[r.staff_id] = { gross: Number(r.gross), net: Number(r.net) };
  });
  return out;
};
