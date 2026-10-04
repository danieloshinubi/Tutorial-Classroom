import React, { useCallback, useEffect, useState } from "react";
import { db } from "../lib/db";
import { Card, Button, Badge, Field, MoneyInput } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { confirmDialog } from "../Components/Confirm";
import { CurrencySelect } from "../Components/LocalePickers";
import { currencyLabel } from "../lib/currencies";
import { formatMoney } from "../lib/money";

// Console → Settings → Plan prices (supabase/227): what Schoolivio charges a
// month for Starter and Growth, in each currency. A school is quoted in its
// own currency when there is a price for it here, else in US dollars when
// that is set, else in naira, so set a price for each currency your schools
// use. Paystack can only charge some currencies; others are marked.

// What Paystack accepts (supabase/functions/_shared/gateways/units.ts).
const PAYSTACK = new Set(["NGN", "GHS", "ZAR", "KES", "USD", "XOF", "EGP", "RWF"]);

interface PriceRow {
  currency: string;
  starter: number;
  growth: number;
  updated_at: string;
}

const PlanPrices = () => {
  const { setError, setNotice } = useActionFeedback();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [draft, setDraft] = useState({ currency: "USD", starter: "", growth: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.from("platform_plan_prices").select("currency, starter, growth, updated_at").order("currency");
    if (error) return setError(error.message);
    setRows((data || []) as PriceRow[]);
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (r: PriceRow) => setDraft({ currency: r.currency, starter: String(r.starter), growth: String(r.growth) });

  const save = async () => {
    const starter = Number(draft.starter);
    const growth = Number(draft.growth);
    if (!(starter > 0) || !(growth > 0)) return setError("Enter both monthly prices.");
    setBusy(true);
    const { error } = await db.rpc("platform_set_plan_price", { currency_in: draft.currency, starter_in: starter, growth_in: growth });
    setBusy(false);
    if (error) return setError(error.message);
    setNotice(`Prices in ${draft.currency} saved.`);
    setDraft({ currency: "USD", starter: "", growth: "" });
    load();
  };

  const remove = async (r: PriceRow) => {
    if (!(await confirmDialog(`Remove the ${r.currency} prices? Schools using ${r.currency} will be quoted in US dollars (if set) or naira.`))) return;
    const { error } = await db.rpc("platform_remove_plan_price", { currency_in: r.currency });
    if (error) return setError(error.message);
    load();
  };

  const existing = rows.some((r) => r.currency === draft.currency);

  return (
    <Card>
      <h3 style={{ margin: 0 }}>{"Plan prices"}</h3>
      <p className="plan-pay-note">
        {"A month of each plan, per currency. A school is charged in its own currency when it has a price here, else in US dollars if set, else in naira. Prices are shown on schoolivio.com too."}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{"Currency"}</th>
              <th>{"Starter (≤200 students)"}</th>
              <th>{"Growth (≤800)"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.currency}>
                <td>
                  {currencyLabel(r.currency)}{" "}
                  {PAYSTACK.has(r.currency) ? null : <Badge tone="warn">{"Paystack can't charge this"}</Badge>}
                </td>
                <td>{formatMoney(r.starter, r.currency)}</td>
                <td>{formatMoney(r.growth, r.currency)}</td>
                <td>
                  <div className="btn-row">
                    <Button size="sm" variant="secondary" onClick={() => edit(r)}>
                      {"Edit"}
                    </Button>
                    {r.currency !== "NGN" ? (
                      <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                        {"Remove"}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="plan-price-form">
        <Field label="Currency">
          <CurrencySelect value={draft.currency} onChange={(currency) => setDraft({ ...draft, currency })} />
        </Field>
        <Field label="Starter a month">
          <MoneyInput value={draft.starter} onChange={(v) => setDraft({ ...draft, starter: v })} placeholder="0" />
        </Field>
        <Field label="Growth a month">
          <MoneyInput value={draft.growth} onChange={(v) => setDraft({ ...draft, growth: v })} placeholder="0" />
        </Field>
      </div>
      {!PAYSTACK.has(draft.currency) ? (
        <p className="plan-pay-note">
          {`Paystack does not charge in ${draft.currency}. Schools in ${draft.currency} will see the price but be asked to write to you to pay. To take their payment online, set a US dollar price and remove this one.`}
        </p>
      ) : null}
      <div className="btn-row">
        <Button type="button" disabled={busy} onClick={save}>
          {busy ? "Saving…" : existing ? `Update ${draft.currency} prices` : `Add ${draft.currency} prices`}
        </Button>
      </div>
    </Card>
  );
};

export default PlanPrices;
