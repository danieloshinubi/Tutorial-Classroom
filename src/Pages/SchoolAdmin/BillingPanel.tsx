import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, Button, Badge, Notice, Empty, SkeletonText, formatDate } from "../../Components/UI";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSubscription,
  startSubscriptionPayment,
  verifySubscriptionPayment,
  takeReturnedReference,
  naira,
  PLAN_LABEL,
  type SchoolSubscription,
} from "../../lib/subscriptionApi";

// School admin → Plan & billing (supabase/225), and the same card on the
// "trial has ended" screen (TrialGate), where a lapsed school can still pay.
// Shows the plan the school's student numbers put it on, when the trial or
// paid month ends, and pays the month with Paystack. Back from Paystack, the
// payment is checked with Paystack on the server before anything changes.

const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const end = new Date(iso.length <= 10 ? `${iso}T23:59:59` : iso).getTime();
  return Math.ceil((end - Date.now()) / 86400000);
};

const STATUS_TONE: Record<string, string> = { paid: "success", pending: "warn", failed: "danger", abandoned: "muted" };

export const PlanPayCard = ({ compact = false }: { compact?: boolean }) => {
  const { schoolId, reload } = useSchool();
  const [sub, setSub] = useState<SchoolSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ tone: string; text: string } | null>(null);
  const checked = useRef(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      setSub(await fetchSubscription(schoolId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  // Back from Paystack: check that payment once, then reload everything.
  useEffect(() => {
    if (checked.current || !schoolId) return;
    checked.current = true;
    const ref = takeReturnedReference();
    if (!ref) {
      load();
      return;
    }
    setResult({ tone: "muted", text: "Checking your payment with Paystack…" });
    verifySubscriptionPayment(ref)
      .then(async (r) => {
        if (r.status === "paid") {
          setResult({
            tone: "success",
            text: `Payment received. Thank you! You are paid up until ${r.period_end ? formatDate(r.period_end, { withTime: false }) : "next month"}.`,
          });
          await reload();
        } else if (r.status === "pending") {
          setResult({ tone: "warn", text: "Paystack has not confirmed this payment yet. Refresh this page in a minute." });
        } else {
          setResult({ tone: "error", text: "That payment did not go through. Nothing was charged. You can try again." });
        }
      })
      .catch((err: Error) => setResult({ tone: "error", text: err.message }))
      .finally(load);
  }, [schoolId, load, reload]);

  const pay = async () => {
    if (!schoolId) return;
    setPaying(true);
    setError("");
    try {
      await startSubscriptionPayment(schoolId);
    } catch (err) {
      setError((err as Error).message);
      setPaying(false);
    }
  };

  if (loading) return <Card><SkeletonText lines={4} /></Card>;
  if (!sub) return <Notice tone="error">{error || "Could not load the school's plan."}</Notice>;

  const onTrial = sub.current_plan === "trial";
  const ends = onTrial ? sub.trial_ends_at : sub.paid_until;
  const left = daysUntil(ends);
  const mailto = `mailto:${sub.contact_email}?subject=${encodeURIComponent("Schoolivio subscription")}`;

  return (
    <Card className="plan-pay">
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="plan-pay-head">
        <div>
          <span className="file-meta">{"Current plan"}</span>
          <h3>{PLAN_LABEL[sub.current_plan] || sub.current_plan}</h3>
        </div>
        {ends ? (
          <Badge tone={left !== null && left <= 5 ? (left < 0 ? "danger" : "warn") : "muted"}>
            {left !== null && left < 0
              ? `${onTrial ? "Trial ended" : "Ended"} ${formatDate(ends, { withTime: false })}`
              : `${onTrial ? "Trial ends" : "Paid until"} ${formatDate(ends, { withTime: false })}`}
          </Badge>
        ) : null}
      </div>

      {sub.amount ? (
        <p>
          {`With ${sub.students} active student${sub.students === 1 ? "" : "s"}, your school is on `}
          <strong>{sub.plan_name}</strong>
          {" at "}
          <strong>{`${naira(sub.amount)} a month`}</strong>
          {"."}
          {!onTrial && sub.paid_until ? " Paying now adds a month after your current one." : ""}
        </p>
      ) : (
        <p>
          {`With ${sub.students} active students, your school is on `}
          <strong>{"Enterprise"}</strong>
          {", which we price with you directly. Please write to us."}
        </p>
      )}

      <div className="btn-row">
        {sub.amount ? (
          <Button onClick={pay} disabled={paying}>
            {paying ? "Opening Paystack…" : `Pay ${naira(sub.amount)} with Paystack`}
          </Button>
        ) : null}
        <a className="btn btn-secondary" href={mailto}>
          {"Email us"}
        </a>
      </div>
      <p className="plan-pay-note">
        {"Prefer to pay another way, or have a question? Write to "}
        <a href={mailto}>{sub.contact_email}</a>
        {"."}
      </p>

      {!compact && sub.payments.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{"Date"}</th>
                <th>{"Plan"}</th>
                <th>{"Amount"}</th>
                <th>{"Covers until"}</th>
                <th>{"Status"}</th>
              </tr>
            </thead>
            <tbody>
              {sub.payments.map((p) => (
                <tr key={p.reference}>
                  <td>{formatDate(p.paid_at || p.created_at, { withTime: false })}</td>
                  <td>{PLAN_LABEL[p.plan] || p.plan}</td>
                  <td>{naira(p.amount)}</td>
                  <td>{p.period_end ? formatDate(p.period_end, { withTime: false }) : "—"}</td>
                  <td>
                    <Badge tone={STATUS_TONE[p.status] || "muted"}>{p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
};

const BillingPanel = () => {
  const { isAdmin } = useSchool();
  if (!isAdmin) return <Empty>{"Only the school's owner or an administrator can see and pay for its plan."}</Empty>;
  return (
    <>
      <PlanPayCard />
      <Card className="plan-pay-prices">
        <span className="file-meta">{"Plans"}</span>
        <ul>
          <li>
            <strong>{"Starter"}</strong>
            {" — ₦450,000 a month, up to 200 students"}
          </li>
          <li>
            <strong>{"Growth"}</strong>
            {" — ₦950,000 a month, up to 800 students"}
          </li>
          <li>
            <strong>{"Enterprise"}</strong>
            {" — more than 800 students, priced with you"}
          </li>
        </ul>
        <p className="plan-pay-note">{"Your plan follows your number of active students and is worked out when you pay."}</p>
      </Card>
    </>
  );
};

export default BillingPanel;
