import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { fetchMyInvoices, fetchPaymentByReference } from "../../lib/api";
import { Page, Card, Button, Notice, Empty } from "../../Components/UI";

// Where Paystack sends a family back to.
//
// This page deliberately decides nothing. It does not credit the invoice, and
// it does not believe the query string — anybody can type ?status=success.
// Crediting happens in the paystack-webhook function, which can prove
// Paystack sent the event by checking its signature.
//
// So all this does is wait a moment and re-read the balance from the
// database. If the webhook has landed, the new figure is simply there.
const PaymentReturn = () => {
  const [params] = useSearchParams();
  const reference = params.get("reference") || params.get("trxref");

  const [state, setState] = useState("checking");
  const [invoices, setInvoices] = useState([]);
  const [attempt, setAttempt] = useState(0);

  const check = useCallback(async () => {
    try {
      const [rows, payment] = await Promise.all([
        fetchMyInvoices(),
        fetchPaymentByReference(reference).catch(() => null),
      ]);
      setInvoices(rows);
      const settled = payment?.status === "approved";
      // The balance is the honest signal, but the webhook may still be in
      // flight. Give it a few seconds before saying anything definite.
      if (settled || attempt >= 4) {
        setState(settled ? "done" : "pending");
      } else {
        setTimeout(() => setAttempt((a) => a + 1), 2000);
      }
    } catch {
      setState("pending");
    }
  }, [reference, attempt]);

  useEffect(() => {
    check();
  }, [check]);

  const owing = invoices
    .filter((i) => i.status === "issued")
    .reduce((sum, i) => sum + Number(i.balance || 0), 0);

  return (
    <div className="shell">
      <Navbar />
      <Page title="Payment">
        {state === "checking" ? (
          <Empty>{"Checking with the school..."}</Empty>
        ) : null}

        {state === "pending" ? (
          <Card style={{ maxWidth: 560 }}>
            <h3>{"Thank you — we are confirming it"}</h3>
            <p style={{ color: "var(--ink-2)" }}>
              {"Your payment has gone to the gateway. The school's record updates as soon as the confirmation arrives, which is usually seconds but can take a little longer."}
            </p>
            <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
              {reference ? `Reference ${reference}. ` : ""}
              {"Nothing more is needed from you — refresh your fees in a moment and the balance will have moved."}
            </p>
            <div className="btn-row">
              <Link to="/Fees">
                <Button>{"Back to fees"}</Button>
              </Link>
            </div>
          </Card>
        ) : null}

        {state === "done" ? (
          <Card style={{ maxWidth: 560 }}>
            <h3>{"Payment received"}</h3>
            <p style={{ color: "var(--ink-2)" }}>
              {owing > 0
                ? "The school has it, and your balance has come down."
                : "The school has it, and nothing is outstanding."}
            </p>
            <div className="btn-row">
              <Link to="/Fees">
                <Button>{"See your fees"}</Button>
              </Link>
            </div>
          </Card>
        ) : null}

        <Notice tone="muted">
          {"A receipt is on the payments list against this invoice."}
        </Notice>
      </Page>
    </div>
  );
};

export default PaymentReturn;
