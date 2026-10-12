// Runs one payroll payout batch through Sznd — called when a bursar/owner/
// admin clicks "Pay via Sznd" on an already-approved run. Mirrors pay-init's
// shape: a caller-scoped check first, then a service-role client for
// everything privileged.
//
// classroom.start_sznd_payroll_payout() (250_payroll_sznd_payouts.sql) does
// the hard part — atomically checking the run is approved, checking the
// school's Sznd balance can actually cover it (see that migration's header
// for why this check exists at all: Sznd pools every school's money into
// one wallet, nothing on their end stops an overdraft), and reserving one
// 'pending' payroll_payouts row per payslip. This function's job is just to
// walk those rows and actually call Sznd for each one.
//
// Per-payslip failure does not abort the batch — 28 successes and 2
// failures is reported as exactly that, not rolled back or retried
// automatically. A failed payslip's payroll_payouts row stays visible for
// the bursar to see and retry by running payout again (start_sznd_
// payroll_payout skips anything already pending/processing/paid, so a
// retry only ever picks up what's still outstanding).
//
// STATUS: confirmed live 2026-10-12 — beneficiary creation, a WITHDRAWAL
// quote, accepting it, and the webhook settling payroll_payouts to 'paid'
// all tested end to end against a real staging transaction
// (ref 80C13FA161EB1E40). One real bug found and fixed in that pass: a
// quote's total_payable includes Sznd's fees on top of the amount the
// beneficiary actually receives (₦120 on a ₦5,000 test) — start_sznd_
// payroll_payout's balance check only knows about the net amount, so this
// function re-checks the LIVE balance against each quote's real
// total_payable before ever accepting it (below), rather than trusting the
// coarser reservation made before any quotes existed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";
import { createBeneficiary, createWithdrawalQuote, acceptQuote, getAvailableBalance } from "../_shared/gateways/sznd-payout.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { runId } = await req.json();
    if (!runId) return json({ error: "Which payroll run?" }, 400);

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { db: { schema: "classroom" }, global: { headers: { Authorization: authorization } } },
    );
    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: run } = await caller.from("payroll_runs").select("id, school_id").eq("id", runId).maybeSingle();
    if (!run) return json({ error: "That payroll run is not yours to pay out." }, 404);

    const { data: canDo } = await caller.rpc("can_do_payroll", { target_school: run.school_id });
    if (!canDo) return json({ error: "Only an owner, admin or bursar can run payroll payouts." }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    // Reserves the payout rows and checks the Sznd balance — see this
    // function's own header comment for why the balance check has to
    // happen here, atomically, not as a separate query from this function.
    const { data: payouts, error: startError } = await admin.rpc("start_sznd_payroll_payout", {
      target_run: runId,
      actor: authUser.user.id,
    });
    if (startError) return json({ error: startError.message }, 400);
    if (!payouts || payouts.length === 0) {
      return json({ error: "Nothing was queued for payout." }, 400);
    }

    const { data: gateway } = await admin
      .from("payment_gateways")
      .select("id, mode, provider")
      .eq("school_id", run.school_id)
      .single();

    let secrets: Record<string, string> = {};
    if (gateway?.mode === "byo") {
      const { data: secretData } = await admin.rpc("get_gateway_secret", { target_gateway: gateway.id });
      secrets = secretData || {};
    } else {
      secrets = resolvePlatformSecrets("sznd");
    }
    if (!secrets.api_key || !secrets.secret_key) {
      return json({ error: "This school's Sznd credentials are not fully configured." }, 503);
    }
    const szndSecrets = { api_key: secrets.api_key, secret_key: secrets.secret_key };

    const results: Array<{ payslipId: string; status: "processing" | "failed"; error?: string }> = [];

    for (const payout of payouts) {
      const { data: slip } = await admin
        .from("payslips")
        .select("id, staff_id, full_name, bank_name, account_number, account_name")
        .eq("id", payout.payslip_id)
        .single();

      try {
        if (!slip) throw new Error("Payslip no longer exists.");

        // Reuse a cached beneficiary id on the staff record across runs;
        // create one (and cache it) the first time, or every time for a
        // payslip whose staff record was since deleted.
        let beneficiaryId: string | null = null;
        if (slip.staff_id) {
          const { data: staff } = await admin
            .from("payroll_staff")
            .select("sznd_beneficiary_id")
            .eq("id", slip.staff_id)
            .maybeSingle();
          beneficiaryId = staff?.sznd_beneficiary_id ?? null;
        }
        if (!beneficiaryId) {
          beneficiaryId = await createBeneficiary(szndSecrets, {
            fullName: slip.full_name,
            bankName: slip.bank_name,
            accountNumber: slip.account_number,
            accountName: slip.account_name,
          });
          if (slip.staff_id) {
            await admin.from("payroll_staff").update({ sznd_beneficiary_id: beneficiaryId }).eq("id", slip.staff_id);
          }
        }

        const quote = await createWithdrawalQuote(szndSecrets, {
          beneficiaryId,
          amount: Number(payout.amount),
          narration: `Salary — ${slip.full_name}`,
          reference: payout.gateway_ref,
        });

        // Re-check against the real, fee-inclusive cost right before
        // committing — start_sznd_payroll_payout's reservation only knew
        // about the net amount, not Sznd's fees on top of it (see this
        // file's header). Other payouts already accepted in this same
        // batch loop reduce what's actually still available, so this has
        // to be a fresh read each time, not the balance from batch start.
        //
        // Two independent numbers, both checked — the lower one wins:
        //   our ledger       what THIS school has collected vs. already
        //                     paid out (the pooled-wallet protection —
        //                     see 250's header for why that exists at all)
        //   Sznd's real wallet  what's actually spendable RIGHT NOW. A
        //                     card deposit can sit for a long time before
        //                     becoming available even once our ledger
        //                     already counts it (confirmed live — see
        //                     sznd-payout.ts's header). Our ledger alone
        //                     would have waved this payout through.
        const { data: ourLedger } = await admin.rpc("sznd_school_balance", { target_school: run.school_id });
        const szndAvailable = await getAvailableBalance(szndSecrets);
        const trueAvailable = Math.min(Number(ourLedger), szndAvailable);
        if (trueAvailable < quote.totalPayable) {
          throw new Error(
            `This payout needs ₦${quote.totalPayable.toLocaleString()} including fees — this school's ledger shows ₦${Number(ourLedger).toLocaleString()}, but only ₦${szndAvailable.toLocaleString()} is actually available on Sznd right now.`,
          );
        }

        await acceptQuote(szndSecrets, quote.quoteId);

        await admin
          .from("payroll_payouts")
          .update({ status: "processing", beneficiary_id: beneficiaryId, updated_at: new Date().toISOString() })
          .eq("id", payout.id);
        results.push({ payslipId: payout.payslip_id, status: "processing" });
      } catch (err) {
        const message = (err as Error).message || "Could not pay this person.";
        await admin.rpc("settle_sznd_payroll_payout", {
          target_reference: payout.gateway_ref,
          new_status: "failed",
          failure_reason_in: message,
        });
        results.push({ payslipId: payout.payslip_id, status: "failed", error: message });
      }
    }

    return json({
      queued: payouts.length,
      processing: results.filter((r) => r.status === "processing").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not run payroll payout." }, 500);
  }
});
