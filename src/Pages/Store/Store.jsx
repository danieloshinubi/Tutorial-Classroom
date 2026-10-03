import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool, useModuleAccess } from "../../context/SchoolContext";
import { useMoney } from "../../lib/money";
import { todayISO, daysAgoISO, monthStartISO } from "../../lib/dates";
import {
  fetchStoreProducts,
  saveStoreProduct,
  deleteStoreProduct,
  storeProductHasHistory,
  restockStoreProduct,
  adjustStoreStock,
  recordStoreSale,
  fetchStoreSales,
  voidStoreSale,
  fetchStoreProfit,
  fetchSchoolMembers,
} from "../../lib/api";
import {
  Page,
  Field,
  Button,
  Badge,
  Select,
  MoneyInput,
  DatePicker,
  Tabs,
  displayName,
  formatDate,
  SkeletonCards,
  SkeletonTable,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import ExportButton from "../../Components/ExportButton";

// Spreadsheet columns for the store's lists (Export).
const ITEM_COLUMNS = [
  { key: "name", label: "Item" },
  { key: "size", label: "Size" },
  { key: (p) => CATEGORY_LABEL[p.category] || p.category, label: "Category" },
  { key: "supplier", label: "Vendor / publisher" },
  { key: "cost_price", label: "Cost price", type: "money" },
  { key: "trade_discount", label: "Vendor discount", type: "money" },
  { key: "net_cost", label: "Net cost", type: "money" },
  { key: "sell_price", label: "Sells for", type: "money" },
  { key: "unit_profit", label: "Profit each", type: "money" },
  { key: "stock_qty", label: "In stock", type: "number" },
  { key: "reorder_level", label: "Reorder at", type: "number" },
  { key: (p) => (p.is_active ? "On sale" : "Switched off"), label: "Status" },
];

// The school store: sell at the counter, keep the shelves stocked, and see
// what the store actually makes.
//
// The point of tracking cost apart from price (the school's own words:
// "publishers, discounts obtained, profit") is the Profit tab — so every
// item carries what the school pays, what the supplier knocks off, and what it
// sells for, and the database works the profit out; nobody types it.
//
// Stock is never typed either. It comes in through Restock, goes out through
// a sale, and a stock count that does not match the shelf goes through
// Adjust with a reason — each recorded, so the number on screen always has a
// history behind it (supabase/182).

const CATEGORIES = [
  { value: "uniform", label: "Uniforms" },
  { value: "book", label: "Books" },
  { value: "notebook", label: "Notebooks" },
  { value: "stationery", label: "Stationery" },
  { value: "casual", label: "Casual wear" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
// An example name that fits the kind being added.
const NAME_EXAMPLE = {
  uniform: "Cardigan",
  book: "New General Mathematics",
  notebook: "80-leaf exercise book",
  stationery: "Mathematical set",
  casual: "House T-shirt",
};

// Sizes that are numbers sort as numbers: "Size 8" before "Size 10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byCategoryNameSize = (a, b) =>
  collator.compare(a.category, b.category) ||
  collator.compare(a.name, b.name) ||
  collator.compare(a.size || "", b.size || "");

// How a sale's payment reads in a list. "Add to family's bill" is what the
// counter button says; on a past sale it read like a button.
const PAYMENT_BADGE = { cash: "Cash", transfer: "Transfer", pos: "POS", account: "On family's bill" };

const PAYMENTS = [
  { value: "cash", label: "Cash" },
  { value: "transfer", label: "Transfer" },
  { value: "pos", label: "POS" },
  { value: "account", label: "Add to family's bill" },
];

const itemLabel = (p) => (p.size ? `${p.name} (${p.size})` : p.name);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// Postgres's words, turned into what to do about it.
const friendlyError = (err) => {
  const msg = err?.message || "";
  if (err?.code === "23505" || /duplicate key|store_products_once/i.test(msg)) {
    return "There is already an item with that name and size. Names are matched ignoring case and spacing.";
  }
  if (err?.code === "23503" || /violates foreign key/i.test(msg)) {
    return "This item has been sold or restocked before, so its history has to stay. Switch it off instead of deleting it.";
  }
  if (/store_products_discount_within_cost/i.test(msg)) {
    return "The supplier discount cannot be more than the cost price.";
  }
  return msg || "Something went wrong. Please try again.";
};

// Local calendar dates (src/lib/dates.js). These used toISOString(), which is
// UTC, and the Profit tab opened on "Aug 31".

const stockState = (p) =>
  p.stock_qty <= 0 ? "out" : p.reorder_level > 0 && p.stock_qty <= p.reorder_level ? "low" : "ok";

const StockBadge = ({ product }) => {
  const state = stockState(product);
  if (state === "out") return <Badge tone="danger">{"Out of stock"}</Badge>;
  if (state === "low") return <Badge tone="warn">{`${product.stock_qty} left`}</Badge>;
  return <span className="st-stock-ok">{`${product.stock_qty} in stock`}</span>;
};

const EmptyState = ({ title, children }) => (
  <div className="st-empty">
    <strong>{title}</strong>
    {children ? <span>{children}</span> : null}
  </div>
);

/* ===================================================================== sell */

const Sell = ({ schoolId, products, students, money, onSold, onRefresh, onError, goToItems }) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState({}); // productId -> qty
  const [buyerKind, setBuyerKind] = useState("pupil");
  const [studentId, setStudentId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [payment, setPayment] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const active = products.filter((p) => p.is_active);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  // Only the kinds this store actually has, so there is no "Stationery" chip
  // leading to an empty grid.
  const kinds = CATEGORIES.filter((c) => active.some((p) => p.category === c.value));

  // Whenever stock is reloaded, the sale is held to what is really there. A
  // refused sale ("Only 2 left…") used to leave the tile showing the old
  // count and the sale still asking for 3 until the next successful sale.
  useEffect(() => {
    setCart((c) => {
      let changed = false;
      const next = {};
      Object.entries(c).forEach(([id, qty]) => {
        const p = byId[id];
        const max = p && p.is_active ? p.stock_qty : 0;
        const kept = Math.min(qty, max);
        if (kept !== qty) changed = true;
        if (kept > 0) next[id] = kept;
      });
      return changed ? next : c;
    });
  }, [byId]);

  // On a phone the sale sits under the items, reached by a bar pinned to the
  // bottom of the screen. The bar used to stay put on top of "Complete sale"
  // once you got there; it now goes away while the sale is on screen.
  const cartRef = useRef(null);
  const [cartVisible, setCartVisible] = useState(false);
  const hasProducts = products.length > 0;
  useEffect(() => {
    const el = cartRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setCartVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
    // Re-attached once there are items: with none, the panel is not rendered.
  }, [hasProducts]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return active.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!needle) return true;
      return [p.name, p.size, p.supplier].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
    });
  }, [active, query, category]);

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ product: byId[id], qty }))
    .filter((l) => l.product && l.qty > 0);
  const total = lines.reduce((sum, l) => sum + Number(l.product.sell_price) * l.qty, 0);
  const count = lines.reduce((sum, l) => sum + l.qty, 0);

  const add = (p) => {
    setReceipt(null);
    setCart((c) => {
      const next = Math.min((c[p.id] || 0) + 1, p.stock_qty);
      return { ...c, [p.id]: next };
    });
  };
  const setQty = (id, qty) =>
    setCart((c) => {
      const p = byId[id];
      const next = Math.max(0, Math.min(Number(qty) || 0, p ? p.stock_qty : 0));
      const copy = { ...c };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  // Only a pupil's purchase can go on a family's bill.
  useEffect(() => {
    if (buyerKind !== "pupil" && payment === "account") setPayment("cash");
  }, [buyerKind, payment]);

  const student = students.find((s) => s.id === studentId);

  const complete = async () => {
    onError("");
    if (!lines.length) return onError("Add at least one item to the sale.");
    if (buyerKind === "pupil" && !studentId) return onError("Choose the pupil, or switch to a walk-in buyer.");
    if (buyerKind === "walkin" && !buyerName.trim()) return onError("Type the buyer's name.");
    setBusy(true);
    try {
      const sale = await recordStoreSale({
        schoolId,
        studentId: buyerKind === "pupil" ? studentId : null,
        buyerName: buyerKind === "walkin" ? buyerName.trim() : null,
        payment,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        note: note.trim(),
      });
      setReceipt({
        sale,
        lines,
        who: buyerKind === "pupil" ? (student ? displayName(student) : "Pupil") : buyerName.trim(),
      });
      setCart({});
      setNote("");
      setBuyerName("");
      onSold();
    } catch (err) {
      onError(friendlyError(err));
      // Most refusals are about stock (someone else sold it, or a count
      // changed it): reload it so the screen and the sale match the shelf.
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const clearSale = () => {
    setCart({});
    setNote("");
    setBuyerName("");
    setStudentId("");
  };

  if (!products.length) {
    return (
      <EmptyState title="The store has no items yet">
        {"Add what you sell under Items — each uniform size, book and notebook with its cost and selling price — then sell from here."}
        <Button onClick={goToItems}>{"Add items"}</Button>
      </EmptyState>
    );
  }

  return (
    <div className="st-sell">
      <section className="st-catalogue">
        <div className="st-catalogue-tools">
          <input
            className="input"
            placeholder="Find an item"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="st-chips">
            {[{ value: "all", label: "Everything" }, ...kinds].map((c) => (
              <button
                key={c.value}
                type="button"
                className={`st-chip${category === c.value ? " active" : ""}`}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState title="Nothing matches">{"Try another name, or choose Everything."}</EmptyState>
        ) : (
          <div className="st-tiles">
            {shown.map((p) => {
              const out = p.stock_qty <= 0;
              const inCart = cart[p.id] || 0;
              const full = inCart >= p.stock_qty;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`st-tile${out ? " out" : ""}${inCart ? " in-cart" : ""}`}
                  disabled={out || full}
                  onClick={() => add(p)}
                  title={full && !out ? "All of this item's stock is already in the sale" : undefined}
                >
                  <span className="st-tile-cat">{CATEGORY_LABEL[p.category]}</span>
                  <span className="st-tile-name">{p.name}</span>
                  {p.size ? <span className="st-tile-size">{p.size}</span> : null}
                  <span className="st-tile-foot">
                    <strong>{money(p.sell_price)}</strong>
                    <StockBadge product={p} />
                  </span>
                  {inCart ? <span className="st-tile-count" aria-label={`${inCart} in the sale`}>{inCart}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="st-cart" id="st-cart" aria-label="This sale" ref={cartRef}>
        {receipt ? (
          <div className="st-receipt">
            <span className="st-label">{"Sale recorded"}</span>
            <strong className="st-receipt-ref">{receipt.sale.reference}</strong>
            <span className="st-muted">{formatDate(receipt.sale.sold_at)}</span>
            <ul className="st-receipt-lines">
              {receipt.lines.map((l) => (
                <li key={l.product.id}>
                  <span>{`${itemLabel(l.product)}${l.qty > 1 ? ` × ${l.qty}` : ""}`}</span>
                  <span className="st-num">{money(Number(l.product.sell_price) * l.qty)}</span>
                </li>
              ))}
              <li className="st-receipt-total">
                <span>{"Total"}</span>
                <span className="st-num">{money(receipt.sale.total)}</span>
              </li>
            </ul>
            <p className="st-muted">
              {`${receipt.who} · ${PAYMENT_BADGE[receipt.sale.payment]}`}
            </p>
            {receipt.sale.payment === "account" ? (
              <p className="st-receipt-note">
                {`Added to ${receipt.who}'s bill as a draft. It reaches the family when the bursar issues it under Bursary → Invoices → Drafts.`}
              </p>
            ) : null}
            <Button onClick={() => setReceipt(null)}>{"New sale"}</Button>
          </div>
        ) : (
          <>
            <div className="st-cart-head">
              <h2>{"This sale"}</h2>
              {lines.length ? (
                <button type="button" className="st-link" onClick={clearSale}>
                  {"Clear"}
                </button>
              ) : null}
            </div>

            {lines.length === 0 ? (
              <p className="st-muted st-cart-empty">{"Tap an item to add it."}</p>
            ) : (
              <ul className="st-lines">
                {lines.map((l) => (
                  <li key={l.product.id} className="st-line">
                    <div className="st-line-name">
                      <span>{itemLabel(l.product)}</span>
                      <span className="st-muted">{`${money(l.product.sell_price)} each`}</span>
                    </div>
                    <div className="st-stepper">
                      <button type="button" aria-label={`One fewer ${l.product.name}`} onClick={() => setQty(l.product.id, l.qty - 1)}>
                        {"−"}
                      </button>
                      <input
                        aria-label={`How many ${l.product.name}`}
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(e) => setQty(l.product.id, e.target.value.replace(/\D/g, ""))}
                      />
                      <button
                        type="button"
                        aria-label={`One more ${l.product.name}`}
                        disabled={l.qty >= l.product.stock_qty}
                        onClick={() => setQty(l.product.id, l.qty + 1)}
                      >
                        {"+"}
                      </button>
                    </div>
                    <span className="st-num st-line-total">{money(Number(l.product.sell_price) * l.qty)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="st-total">
              <span>{`Total${count ? ` · ${count} item${count === 1 ? "" : "s"}` : ""}`}</span>
              <strong className="st-num">{money(total)}</strong>
            </div>

            <div className="st-buyer">
              <span className="st-label">{"Who is it for"}</span>
              <div className="st-seg" role="radiogroup" aria-label="Buyer">
                <button type="button" role="radio" aria-checked={buyerKind === "pupil"} className={buyerKind === "pupil" ? "on" : ""} onClick={() => setBuyerKind("pupil")}>
                  {"A pupil"}
                </button>
                <button type="button" role="radio" aria-checked={buyerKind === "walkin"} className={buyerKind === "walkin" ? "on" : ""} onClick={() => setBuyerKind("walkin")}>
                  {"Walk-in"}
                </button>
              </div>
              {buyerKind === "pupil" ? (
                students.length ? (
                  <Select
                    className="select"
                    value={studentId}
                    placeholder="Choose the pupil"
                    onChange={setStudentId}
                    options={students.map((s) => ({ value: s.id, label: displayName(s) }))}
                  />
                ) : (
                  <p className="st-muted">{"No pupils at the school yet. Sell to a walk-in instead."}</p>
                )
              ) : (
                <input
                  className="input"
                  placeholder="Buyer's name"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                />
              )}
            </div>

            <div className="st-buyer">
              <span className="st-label">{"How they paid"}</span>
              <div className="st-pay">
                {PAYMENTS.map((p) => {
                  const disabled = p.value === "account" && buyerKind !== "pupil";
                  return (
                    <button
                      key={p.value}
                      type="button"
                      className={`st-chip${payment === p.value ? " active" : ""}`}
                      disabled={disabled}
                      title={disabled ? "Only a pupil's purchase can go on a family's bill" : undefined}
                      onClick={() => setPayment(p.value)}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {payment === "account" ? (
                <p className="st-muted">
                  {"The amount goes on the family's bill as a draft, filed under the current term. Nothing is collected at the counter."}
                </p>
              ) : null}
            </div>

            <input
              className="input"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {/* Pinned to the bottom of the panel: with a few lines in the sale
                the panel scrolls, and the button used to scroll out of view. */}
            <div className="st-cart-cta">
              <Button disabled={busy || !lines.length} onClick={complete}>
                {busy ? "Recording..." : lines.length ? `Complete sale · ${money(total)}` : "Complete sale"}
              </Button>
            </div>
          </>
        )}
      </aside>

      {/* On a phone the sale sits below the items; this keeps it one tap away. */}
      {lines.length && !receipt && !cartVisible ? (
        <button
          type="button"
          className="st-cart-jump"
          onClick={() => document.getElementById("st-cart")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span>{`View sale · ${count} item${count === 1 ? "" : "s"}`}</span>
          <strong className="st-num">{money(total)}</strong>
        </button>
      ) : null}
    </div>
  );
};

/* ==================================================================== items */

const blankForm = {
  id: null,
  name: "",
  size: "",
  category: "uniform",
  supplier: "",
  costPrice: "",
  tradeDiscount: "",
  sellPrice: "",
  reorderLevel: "",
  openingStock: "",
  isActive: true,
};

const Items = ({ schoolId, products, money, onChange, onError }) => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [openRow, setOpenRow] = useState(null); // { id, kind: 'restock' | 'adjust' }
  const [rowForm, setRowForm] = useState({});
  const [rowBusy, setRowBusy] = useState(false);
  // View-only access: the list and its figures, without the buttons that change them.
  const { canEdit } = useModuleAccess("store");

  const set =(key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const cost = Number(form?.costPrice || 0);
  const disc = Number(form?.tradeDiscount || 0);
  const sell = Number(form?.sellPrice || 0);
  const net = cost - disc;
  const profit = sell - net;

  const edit = (p) =>
    setForm({
      id: p.id,
      name: p.name,
      size: p.size || "",
      category: p.category,
      supplier: p.supplier || "",
      costPrice: String(p.cost_price ?? ""),
      // Left empty when nothing was ever entered, rather than reopening as
      // "0" — an empty box and a zero said different things.
      tradeDiscount: Number(p.trade_discount) ? String(p.trade_discount) : "",
      sellPrice: String(p.sell_price ?? ""),
      reorderLevel: Number(p.reorder_level) ? String(p.reorder_level) : "",
      openingStock: "",
      isActive: p.is_active,
    });

  const save = async (event) => {
    event.preventDefault();
    onError("");
    if (!form.name.trim()) return onError("Give the item a name.");
    if (disc > cost) return onError("The supplier discount cannot be more than the cost price.");
    setSaving(true);
    try {
      const saved = await saveStoreProduct({ ...form, schoolId, name: form.name.trim(), size: form.size.trim(), supplier: form.supplier.trim() });
      const opening = Number(form.openingStock || 0);
      if (!form.id && opening > 0) {
        await restockStoreProduct({ productId: saved.id, qty: opening, note: "Opening stock" });
      }
      setForm(null);
      onChange(form.id ? "Item updated." : `${itemLabel(saved)} added${opening > 0 ? ` with ${opening} in stock` : ""}.`);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  // Asks first whether the item has history. The dialog used to look the same
  // either way — offering Delete for an item that had been sold, which the
  // database then refused. It also dropped the size ("Delete TEST Cardigan?").
  const remove = async () => {
    const label = form.size.trim() ? `${form.name} (${form.size.trim()})` : form.name;
    setSaving(true);
    let history = true;
    try {
      history = await storeProductHasHistory(form.id);
    } catch {
      history = true;
    } finally {
      setSaving(false);
    }

    if (history) {
      const current = products.find((p) => p.id === form.id);
      const ok = await confirmDialog({
        title: `${label} can't be deleted`,
        body: current?.is_active
          ? "It has been stocked or sold, and that history has to stay. Switch it off instead: it leaves the counter, and its sales stay on record."
          : "It has been stocked or sold, and that history has to stay. It is already switched off, so it no longer appears at the counter.",
        confirmLabel: current?.is_active ? "Switch it off" : "OK",
      });
      if (ok && current?.is_active) {
        setForm(null);
        await toggleActive(current);
      }
      return;
    }

    if (!(await confirmDialog({ title: `Delete ${label}?`, body: "It has never been stocked or sold, so it can be removed completely.", confirmLabel: "Delete" }))) return;
    setSaving(true);
    try {
      await deleteStoreProduct(form.id, schoolId);
      setForm(null);
      onChange(`${label} deleted.`);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p) => {
    onError("");
    try {
      await saveStoreProduct({
        id: p.id,
        schoolId,
        name: p.name,
        size: p.size,
        category: p.category,
        supplier: p.supplier,
        costPrice: p.cost_price,
        tradeDiscount: p.trade_discount,
        sellPrice: p.sell_price,
        reorderLevel: p.reorder_level,
        isActive: !p.is_active,
      });
      onChange(p.is_active ? `${itemLabel(p)} switched off. It no longer appears at the counter.` : `${itemLabel(p)} switched back on.`);
    } catch (err) {
      onError(friendlyError(err));
    }
  };

  const openFor = (p, kind) => {
    setOpenRow({ id: p.id, kind });
    setRowForm(
      kind === "restock"
        ? { qty: "", unitCost: String(p.cost_price ?? ""), unitDiscount: String(p.trade_discount ?? ""), note: "" }
        : { qty: "", reason: "" }
    );
  };

  const submitRow = async (p) => {
    onError("");
    setRowBusy(true);
    try {
      if (openRow.kind === "restock") {
        if (!Number(rowForm.qty)) throw new Error("How many came in?");
        await restockStoreProduct({
          productId: p.id,
          qty: rowForm.qty,
          unitCost: rowForm.unitCost,
          unitDiscount: rowForm.unitDiscount,
          note: rowForm.note,
        });
        onChange(`${rowForm.qty} ${itemLabel(p)} added to stock.`);
      } else {
        // The person types what they counted; the change is worked out here.
        // Asking for "+/- by how many" made them do the subtraction.
        if (rowForm.qty === "") throw new Error("How many did you count on the shelf?");
        const change = Number(rowForm.qty) - p.stock_qty;
        if (change === 0) throw new Error(`That matches the ${p.stock_qty} on record, so nothing needs changing.`);
        await adjustStoreStock({ productId: p.id, qtyChange: change, reason: rowForm.reason });
        onChange("Stock count updated.");
      }
      setOpenRow(null);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setRowBusy(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const counts = CATEGORIES.reduce((acc, c) => ({ ...acc, [c.value]: products.filter((p) => p.category === c.value).length }), {});
  const lowCount = products.filter((p) => p.is_active && stockState(p) !== "ok").length;
  const shown = products.filter((p) => {
    if (category === "low" ? !(p.is_active && stockState(p) !== "ok") : category !== "all" && p.category !== category) return false;
    if (!needle) return true;
    return [p.name, p.size, p.supplier].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
  });

  return (
    <div className="st-stack">
      <div className="st-toolbar">
        <div className="st-chips">
          {[{ value: "all", label: "All", n: products.length }, ...CATEGORIES.map((c) => ({ ...c, n: counts[c.value] }))]
            .filter((c) => c.value === "all" || c.n)
            .map((c) => (
              <button key={c.value} type="button" className={`st-chip${category === c.value ? " active" : ""}`} onClick={() => setCategory(c.value)}>
                {c.label}
                <span className="st-chip-count">{c.n}</span>
              </button>
            ))}
          {lowCount ? (
            <button type="button" className={`st-chip warn${category === "low" ? " active" : ""}`} onClick={() => setCategory("low")}>
              {"Running low"}
              <span className="st-chip-count">{lowCount}</span>
            </button>
          ) : null}
        </div>
        <div className="st-toolbar-end">
          <input className="input st-search" placeholder="Find an item" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ExportButton module="store" roles={["bursar"]} filename="store-items" sheetName="Store items" columns={ITEM_COLUMNS} rows={shown} />
          {canEdit ? (
            <Button onClick={() => setForm(form && !form.id ? null : { ...blankForm })}>
              {form && !form.id ? "Cancel" : "Add item"}
            </Button>
          ) : null}
        </div>
      </div>

      {form ? (
        <form className="st-card st-form" onSubmit={save}>
          <h2 className="st-card-title">{form.id ? `Edit ${itemLabel(form)}` : "Add an item"}</h2>
          <div className="st-form-grid">
            <Field label="Name">
              <input
                className="input"
                autoFocus
                value={form.name}
                placeholder={NAME_EXAMPLE[form.category] || "Cardigan"}
                onChange={(e) => set("name")(e.target.value)}
              />
            </Field>
            <Field label="Size, edition or level" hint="Optional. Each size is its own item with its own stock.">
              <input className="input" value={form.size} placeholder="Size 8" onChange={(e) => set("size")(e.target.value)} />
            </Field>
            <Field label="Kind">
              <Select className="select" value={form.category} onChange={set("category")} options={CATEGORIES} />
            </Field>
            <Field label={form.category === "book" ? "Publisher" : "Supplier"} hint="Optional.">
              <input className="input" value={form.supplier} placeholder={form.category === "book" ? "Longman" : ""} onChange={(e) => set("supplier")(e.target.value)} />
            </Field>
            <Field label="Cost price" hint="What the school pays for one, before any discount.">
              <MoneyInput value={form.costPrice} onChange={set("costPrice")} />
            </Field>
            <Field label={form.category === "book" ? "Publisher's discount" : "Supplier's discount"} hint="Taken off each one. Leave empty if none.">
              <MoneyInput value={form.tradeDiscount} onChange={set("tradeDiscount")} />
            </Field>
            <Field label="Selling price">
              <MoneyInput value={form.sellPrice} onChange={set("sellPrice")} />
            </Field>
            <Field label="Warn me when stock falls to" hint="Optional. Flags the item as running low.">
              <input className="input" inputMode="numeric" value={form.reorderLevel} onChange={(e) => set("reorderLevel")(e.target.value.replace(/\D/g, ""))} />
            </Field>
            {!form.id ? (
              <Field label="Opening stock" hint="How many the school has now. Recorded as the first delivery.">
                <input className="input" inputMode="numeric" value={form.openingStock} onChange={(e) => set("openingStock")(e.target.value.replace(/\D/g, ""))} />
              </Field>
            ) : null}
          </div>

          {/* Worked out as they type, the same way the database does it. */}
          <div className="st-form-preview" aria-live="polite">
            {disc > cost ? (
              // Said straight away. It used to work the numbers out anyway —
              // "pays -₦100 … makes ₦1,600 (107%)", in green.
              <span className="loss">{"The discount is more than the cost price."}</span>
            ) : (
              <>
                <span>{`The school pays ${money(net)} for each`}</span>
                <span className={profit < 0 ? "loss" : "gain"}>
                  {profit < 0
                    ? `Sells at a loss of ${money(-profit)} on each`
                    : `Makes ${money(profit)} on each${sell > 0 ? ` (${pct(profit, sell)}% of the price)` : ""}`}
                </span>
              </>
            )}
          </div>

          <div className="st-form-actions">
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Save changes" : "Add item"}</Button>
            <Button type="button" variant="secondary" onClick={() => setForm(null)}>{"Cancel"}</Button>
            {form.id ? (
              <>
                <span className="st-spacer" />
                {/* Switching off moved here from the row, which had four
                    buttons and pushed the table wider than the page. */}
                {products.find((p) => p.id === form.id)?.is_active ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      const current = products.find((p) => p.id === form.id);
                      setForm(null);
                      toggleActive(current);
                    }}
                  >
                    {"Switch off"}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={remove} disabled={saving}>{"Delete"}</Button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}

      {products.length === 0 && !form ? (
        <EmptyState title="No items yet">
          {"Add each thing the store sells — every uniform size, each textbook, notebooks and stationery — with what it costs and what it sells for."}
        </EmptyState>
      ) : null}

      {shown.length ? (
        <section className="st-card st-card-flush">
          <div className="table-wrap table-wrap-plain">
            {/* Fixed column widths: with automatic widths, opening a Restock or
                Count row under an item re-flowed every column above it. */}
            <table className="data st-table st-items">
              <colgroup>
                <col />
                <col style={{ width: 104 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 112 }} />
                <col style={{ width: 118 }} />
                {canEdit ? <col style={{ width: 222 }} /> : null}
              </colgroup>
              <thead>
                <tr>
                  <th>{"Item"}</th>
                  <th className="num">{"Cost"}</th>
                  <th className="num">{"Discount"}</th>
                  <th className="num">{"Sells for"}</th>
                  <th className="num">{"Profit each"}</th>
                  <th>{"Stock"}</th>
                  {canEdit ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const margin = pct(Number(p.unit_profit), Number(p.sell_price));
                  const open = openRow?.id === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr className={`${p.is_active ? "" : "st-off"}${open ? " st-row-open" : ""}`}>
                        <td>
                          <strong>{itemLabel(p)}</strong>
                          <div className="st-sub">
                            {[CATEGORY_LABEL[p.category], p.supplier, p.is_active ? null : "Switched off"].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        {/* data-label: on a phone each row becomes a card, and
                            the column headings are shown beside each figure. */}
                        <td className="num" data-label="Cost">{money(p.cost_price)}</td>
                        <td className="num" data-label="Discount">{Number(p.trade_discount) > 0 ? `− ${money(p.trade_discount)}` : <span className="st-muted">{"—"}</span>}</td>
                        <td className="num" data-label="Sells for">{money(p.sell_price)}</td>
                        <td className={`num ${Number(p.unit_profit) < 0 ? "st-loss" : "st-gain"}`} data-label="Profit each">
                          <strong>{money(p.unit_profit)}</strong>
                          {margin !== null ? <div className="st-sub">{`${margin}%`}</div> : null}
                        </td>
                        <td data-label="Stock"><StockBadge product={p} /></td>
                        {canEdit ? (
                          <td className="st-actions">
                            {p.is_active ? (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => (open && openRow.kind === "restock" ? setOpenRow(null) : openFor(p, "restock"))}>
                                  {"Restock"}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => (open && openRow.kind === "adjust" ? setOpenRow(null) : openFor(p, "adjust"))}>
                                  {"Count"}
                                </Button>
                              </>
                            ) : (
                              // Not faded with its row, so it does not look disabled.
                              <Button size="sm" variant="secondary" onClick={() => toggleActive(p)}>{"Switch on"}</Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => edit(p)}>{"Edit"}</Button>
                          </td>
                        ) : null}
                      </tr>
                      {open ? (
                        <tr className="st-inline-row">
                          <td colSpan={7}>
                            <div className="st-inline">
                              <span className="st-inline-title">
                                {openRow.kind === "restock"
                                  ? `Stock coming in: ${itemLabel(p)}`
                                  : `Stock count: ${itemLabel(p)} · ${p.stock_qty} on record`}
                              </span>
                              <div className="st-inline-fields">
                                {openRow.kind === "restock" ? (
                                  <>
                                    <label className="st-inline-field">
                                      <span>{"How many"}</span>
                                      <input className="input" inputMode="numeric" autoFocus value={rowForm.qty} onChange={(e) => setRowForm((f) => ({ ...f, qty: e.target.value.replace(/\D/g, "") }))} />
                                    </label>
                                    <label className="st-inline-field">
                                      <span>{"Cost each"}</span>
                                      <MoneyInput value={rowForm.unitCost} onChange={(v) => setRowForm((f) => ({ ...f, unitCost: v }))} />
                                    </label>
                                    <label className="st-inline-field">
                                      <span>{"Discount each"}</span>
                                      <MoneyInput value={rowForm.unitDiscount} onChange={(v) => setRowForm((f) => ({ ...f, unitDiscount: v }))} />
                                    </label>
                                    <label className="st-inline-field st-inline-wide">
                                      <span>{"Note"}</span>
                                      <input className="input" placeholder="Invoice number, delivery" value={rowForm.note} onChange={(e) => setRowForm((f) => ({ ...f, note: e.target.value }))} />
                                    </label>
                                  </>
                                ) : (
                                  <>
                                    <label className="st-inline-field">
                                      <span>{"Counted on the shelf"}</span>
                                      <input className="input" inputMode="numeric" autoFocus placeholder={String(p.stock_qty)} value={rowForm.qty} onChange={(e) => setRowForm((f) => ({ ...f, qty: e.target.value.replace(/\D/g, "") }))} />
                                    </label>
                                    <label className="st-inline-field st-inline-wide">
                                      <span>{"Why"}</span>
                                      <input className="input" placeholder="Damaged, lost, recount" value={rowForm.reason} onChange={(e) => setRowForm((f) => ({ ...f, reason: e.target.value }))} />
                                    </label>
                                  </>
                                )}
                                <div className="st-inline-buttons">
                                  <Button size="sm" disabled={rowBusy} onClick={() => submitRow(p)}>
                                    {rowBusy ? "Saving..." : openRow.kind === "restock" ? "Add to stock" : "Update count"}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setOpenRow(null)}>{"Cancel"}</Button>
                                </div>
                              </div>
                              {openRow.kind === "restock" ? (
                                <span className="st-sub">{"The cost and discount you enter become this item's cost from now on, so profit on the next sale reflects what this stock cost."}</span>
                              ) : rowForm.qty !== "" ? (
                                <span className={`st-sub${Number(rowForm.qty) === p.stock_qty ? "" : " st-count-diff"}`}>
                                  {Number(rowForm.qty) === p.stock_qty
                                    ? `That matches the ${p.stock_qty} on record.`
                                    : Number(rowForm.qty) < p.stock_qty
                                    ? `That's ${p.stock_qty - Number(rowForm.qty)} fewer than the ${p.stock_qty} on record.`
                                    : `That's ${Number(rowForm.qty) - p.stock_qty} more than the ${p.stock_qty} on record.`}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : products.length ? (
        <EmptyState title="Nothing matches">{"Try another name, or choose All."}</EmptyState>
      ) : null}
    </div>
  );
};

/* ==================================================================== sales */

const RangeBar = ({ from, to, setFrom, setTo }) => (
  <div className="st-range">
    <Field label="From">
      <DatePicker value={from} onChange={setFrom} />
    </Field>
    <Field label="To">
      <DatePicker value={to} onChange={setTo} />
    </Field>
  </div>
);

const Sales = ({ schoolId, money, refreshKey, onChange, onError }) => {
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // View-only access reads every sale but cannot void one.
  const { canEdit } = useModuleAccess("store");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      setSales(await fetchStoreSales({ schoolId, from, to }));
    } catch (err) {
      onError(err.message || "Could not load the sales.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, from, to, onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (refreshKey) load({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const live = sales.filter((s) => !s.voided_at);
  const takings = live.reduce((sum, s) => sum + Number(s.total), 0);
  const byMethod = PAYMENTS.map((p) => ({
    ...p,
    amount: live.filter((s) => s.payment === p.value).reduce((sum, s) => sum + Number(s.total), 0),
  })).filter((p) => p.amount > 0);

  const doVoid = async (sale) => {
    onError("");
    if (!reason.trim()) return onError("Say why the sale is being voided — it is kept on the record.");
    setBusy(true);
    try {
      await voidStoreSale({ saleId: sale.id, reason: reason.trim() });
      setVoiding(null);
      setReason("");
      onChange(
        sale.invoice_id
          ? "Sale voided. The items are back in stock and the family's store bill has been cancelled."
          : "Sale voided. The items are back in stock."
      );
      load({ quiet: true });
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-stack">
      <div className="st-range-row">
        <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButton
          module="store"
          roles={["bursar"]}
          filename={`store-sales-${from}-to-${to}`}
          sheetName="Store sales"
          rows={sales}
          columns={[
            { key: "sold_at", label: "Sold", type: "datetime" },
            { key: "reference", label: "Reference" },
            { key: (x) => (x.student ? displayName(x.student) : x.buyer_name || "Walk-in"), label: "Buyer" },
            { key: (x) => (x.items || []).map((i) => `${i.size ? `${i.name} (${i.size})` : i.name}${i.qty > 1 ? ` x ${i.qty}` : ""}`).join(", "), label: "Items" },
            { key: (x) => PAYMENT_BADGE[x.payment] || x.payment, label: "Paid by" },
            { key: "total", label: "Total", type: "money" },
            { key: (x) => (x.voided_at ? `Voided: ${x.void_reason || ""}` : ""), label: "Voided" },
          ]}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : sales.length === 0 ? (
        <EmptyState title="No sales in these dates">{"Widen the dates, or make a sale under Sell."}</EmptyState>
      ) : (
        <>
          {/* Sold and collected, separately. "₦27,800 from 2 sales" counted
              ₦6,000 that was put on a family's bill and not yet paid. */}
          <div className="st-summary">
            <div className="st-summary-item">
              <span className="st-summary-value">{money(takings)}</span>
              <span className="st-summary-label">{`sold in ${live.length} sale${live.length === 1 ? "" : "s"}`}</span>
            </div>
            <div className="st-summary-item">
              <span className="st-summary-value">{money(takings - (byMethod.find((m) => m.value === "account")?.amount || 0))}</span>
              <span className="st-summary-label">{"collected at the counter"}</span>
            </div>
            {byMethod.map((m) => (
              <div key={m.value} className="st-summary-item">
                <span className="st-summary-value small">{money(m.amount)}</span>
                <span className="st-summary-label">{m.value === "account" ? "on family bills" : m.label.toLowerCase()}</span>
              </div>
            ))}
          </div>

          <section className="st-card st-card-flush">
            <ul className="st-sales">
              {sales.map((s) => {
                const who = s.student ? displayName(s.student) : s.buyer_name || "Walk-in";
                const items = (s.items || [])
                  .map((i) => `${i.size ? `${i.name} (${i.size})` : i.name}${i.qty > 1 ? ` × ${i.qty}` : ""}`)
                  .join(", ");
                return (
                  <li key={s.id} className={`st-sale${s.voided_at ? " voided" : ""}`}>
                    <div className="st-sale-main">
                      <div className="st-sale-top">
                        <span className="st-ref">{s.reference}</span>
                        <span className="st-muted">{formatDate(s.sold_at)}</span>
                      </div>
                      <strong>{who}</strong>
                      <span className="st-sub">{items}</span>
                      {s.voided_at ? (
                        <span className="st-void-note">{`Voided: ${s.void_reason}`}</span>
                      ) : null}
                    </div>
                    <div className="st-sale-side">
                      <strong className="st-num">{money(s.total)}</strong>
                      {s.voided_at ? (
                        <Badge>{"Voided"}</Badge>
                      ) : (
                        <Badge tone={s.payment === "account" ? "brand" : undefined}>{PAYMENT_BADGE[s.payment]}</Badge>
                      )}
                      {/* Only "Void" lives here. Cancel is in the row that
                          opens, so a double-click cannot open and shut it. */}
                      {canEdit && !s.voided_at && voiding !== s.id ? (
                        <button type="button" className="st-link" onClick={() => { setVoiding(s.id); setReason(""); }}>
                          {"Void"}
                        </button>
                      ) : null}
                    </div>
                    {canEdit && voiding === s.id ? (
                      <div className="st-void">
                        {s.invoice?.status === "issued" ? (
                          <p className="st-void-warn">
                            {`The family has already been sent ${s.invoice.reference}. Voiding cancels it and tells them it has been withdrawn.`}
                          </p>
                        ) : null}
                        <input
                          className="input"
                          autoFocus
                          placeholder="Why is it being voided? Kept on the record."
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <Button size="sm" disabled={busy} onClick={() => doVoid(s)}>
                          {busy ? "Voiding..." : "Void sale"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setVoiding(null)}>
                          {"Cancel"}
                        </Button>
                        <span className="st-sub">
                          {s.invoice_id
                            ? "The items go back into stock, and the store bill on the family's account is cancelled."
                            : "The items go back into stock. Refund the buyer yourself if money was taken."}
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
};

/* =================================================================== profit */

const Profit = ({ schoolId, products, money, refreshKey, onError }) => {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      setRows(await fetchStoreProfit({ schoolId, from, to }));
    } catch (err) {
      onError(err.message || "Could not load the profit figures.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, from, to, onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (refreshKey) load({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const revenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const cost = rows.reduce((s, r) => s + Number(r.cost), 0);
  const profit = rows.reduce((s, r) => s + Number(r.profit), 0);

  const byCategory = CATEGORIES.map((c) => {
    const inCat = rows.filter((r) => r.category === c.value);
    return {
      ...c,
      revenue: inCat.reduce((s, r) => s + Number(r.revenue), 0),
      profit: inCat.reduce((s, r) => s + Number(r.profit), 0),
      qty: inCat.reduce((s, r) => s + Number(r.qty_sold), 0),
    };
  }).filter((c) => c.qty > 0);
  const maxProfit = Math.max(1, ...byCategory.map((c) => Math.abs(c.profit)));

  // What is on the shelf now, at what it cost and at what it would sell for.
  const stockAtCost = products.reduce((s, p) => s + p.stock_qty * Number(p.net_cost), 0);
  const stockAtPrice = products.reduce((s, p) => s + p.stock_qty * Number(p.sell_price), 0);

  return (
    <div className="st-stack">
      <div className="st-range-row">
        <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButton
          module="store"
          roles={["bursar"]}
          filename={`store-profit-${from}-to-${to}`}
          sheets={[
            { name: "By item", rows, columns: [
              { key: (r) => (r.size ? `${r.name} (${r.size})` : r.name), label: "Item" },
              { key: (r) => CATEGORY_LABEL[r.category] || r.category, label: "Category" },
              { key: "qty_sold", label: "Sold", type: "number" },
              { key: "revenue", label: "Takings", type: "money" },
              { key: "cost", label: "Cost", type: "money" },
              { key: "profit", label: "Profit", type: "money" },
            ] },
            { name: "By category", rows: byCategory, columns: [
              { key: "label", label: "Category" },
              { key: "qty", label: "Sold", type: "number" },
              { key: "revenue", label: "Takings", type: "money" },
              { key: "profit", label: "Profit", type: "money" },
            ] },
          ]}
        />
      </div>

      {loading ? (
        <SkeletonCards count={3} lines={2} />
      ) : (
        <>
          <section className="st-figures">
            <div className="st-figure">
              <span className="st-label">{"Takings"}</span>
              <strong className="st-num">{money(revenue)}</strong>
            </div>
            <div className="st-figure">
              <span className="st-label">{"Cost of what sold"}</span>
              <strong className="st-num">{money(cost)}</strong>
            </div>
            <div className={`st-figure main${profit < 0 ? " loss" : ""}`}>
              <span className="st-label">{"Profit"}</span>
              <strong className="st-num">{money(profit)}</strong>
              <span className="st-sub">{revenue > 0 ? `${pct(profit, revenue)}% of takings` : "Nothing sold in these dates"}</span>
            </div>
          </section>

          {byCategory.length ? (
            <section className="st-card">
              <h2 className="st-card-title">{"By kind of item"}</h2>
              <ul className="st-bars">
                {byCategory
                  .sort((a, b) => b.profit - a.profit)
                  .map((c) => (
                    <li key={c.value}>
                      <span className="st-bar-label">{c.label}</span>
                      <span className="st-bar-track" aria-hidden="true">
                        <span
                          className={`st-bar-fill${c.profit < 0 ? " loss" : ""}`}
                          style={{ width: `${(Math.abs(c.profit) / maxProfit) * 100}%` }}
                        />
                      </span>
                      <span className="st-bar-value st-num">{money(c.profit)}</span>
                      <span className="st-sub st-bar-note">{`${c.qty} sold · ${money(c.revenue)} taken`}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          {rows.length ? (
            <section className="st-card st-card-flush">
              <div className="st-card-pad">
                <h2 className="st-card-title">{"By item"}</h2>
              </div>
              <div className="table-wrap table-wrap-plain">
                <table className="data st-table">
                  <thead>
                    <tr>
                      <th>{"Item"}</th>
                      <th className="num">{"Sold"}</th>
                      <th className="num">{"Takings"}</th>
                      <th className="num">{"Cost"}</th>
                      <th className="num">{"Profit"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.product_id}>
                        <td>
                          <strong>{r.size ? `${r.name} (${r.size})` : r.name}</strong>
                          <div className="st-sub">{CATEGORY_LABEL[r.category]}</div>
                        </td>
                        <td className="num">{r.qty_sold}</td>
                        <td className="num">{money(r.revenue)}</td>
                        <td className="num">{money(r.cost)}</td>
                        <td className={`num ${Number(r.profit) < 0 ? "st-loss" : "st-gain"}`}>
                          <strong>{money(r.profit)}</strong>
                          <div className="st-sub">{`${pct(Number(r.profit), Number(r.revenue)) ?? 0}%`}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState title="Nothing sold in these dates">{"Profit appears here once sales are made."}</EmptyState>
          )}

          <section className="st-card st-shelf">
            <div>
              <span className="st-label">{"On the shelf now"}</span>
              <p>
                {/* Pieces, not items: "146 items" meant 146 pieces of 5 items. */}
                {(() => {
                  const pieces = products.reduce((s, p) => s + p.stock_qty, 0);
                  const stocked = products.filter((p) => p.stock_qty > 0).length;
                  return `${pieces} piece${pieces === 1 ? "" : "s"} across ${stocked} item${stocked === 1 ? "" : "s"}, worth `;
                })()}
                <strong>{money(stockAtCost)}</strong>
                {" at cost and "}
                <strong>{money(stockAtPrice)}</strong>
                {" at selling price."}
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

/* ===================================================================== page */

const TABS = [
  { id: "sell", label: "Sell" },
  { id: "items", label: "Items" },
  { id: "sales", label: "Sales" },
  { id: "profit", label: "Profit" },
];

const Store = () => {
  const { school, schoolId } = useSchool();
  const money = useMoney(school?.currency);
  // The tab lives in the address (?tab=profit), so a tab can be linked to and
  // the browser's Back button returns to it.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  // View-only access has no counter to sell from, so it opens on Items.
  const { canEdit } = useModuleAccess("store");
  const tabs = canEdit ? TABS : TABS.filter((t) => t.id !== "sell");
  const tab = tabs.some((t) => t.id === requested) ? requested : tabs[0].id;
  const setTab = (id) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", id);
        return next;
      },
      { replace: true }
    );
  const [products, setProducts] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a sale or a change, so the tabs that keep their own lists
  // refresh them quietly the next time they are open.
  const [refreshKey, setRefreshKey] = useState(0);
  const { setError, setNotice } = useActionFeedback();

  // quiet: refresh underneath without swapping the tab for a skeleton, so a
  // half-filled form or an open restock row is never thrown away.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      const [p, members] = await Promise.all([
        fetchStoreProducts(schoolId),
        fetchSchoolMembers(schoolId).catch(() => []),
      ]);
      // Sizes that are numbers in number order: Size 8 before Size 10.
      setProducts([...p].sort(byCategoryNameSize));
      setStudents(
        members
          .filter((m) => m.role === "student" && m.is_active)
          .map((m) => m.profiles)
          .sort((a, b) => displayName(a).localeCompare(displayName(b)))
      );
    } catch (err) {
      setError(err.message || "Could not load the store.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = (message) => {
    if (message) setNotice(message);
    setRefreshKey((k) => k + 1);
    load({ quiet: true });
  };

  const lowCount = products.filter((p) => p.is_active && stockState(p) !== "ok").length;

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Store"
        subtitle={school ? `Uniforms, books and stationery at ${school.name}` : "Uniforms, books and stationery"}
        toolbar={
          <Tabs
            tabs={tabs.map((t) => (t.id === "items" && lowCount ? { ...t, label: `Items (${lowCount} low)` } : t))}
            active={tab}
            onChange={setTab}
          />
        }
      >
        {loading ? <SkeletonCards count={4} lines={2} /> : null}

        {!loading && tab === "sell" ? (
          <Sell
            schoolId={schoolId}
            products={products}
            students={students}
            money={money}
            onSold={() => changed()}
            onRefresh={() => load({ quiet: true })}
            onError={setError}
            goToItems={() => setTab("items")}
          />
        ) : null}
        {!loading && tab === "items" ? (
          <Items schoolId={schoolId} products={products} money={money} onChange={changed} onError={setError} />
        ) : null}
        {!loading && tab === "sales" ? (
          <Sales schoolId={schoolId} money={money} refreshKey={refreshKey} onChange={changed} onError={setError} />
        ) : null}
        {!loading && tab === "profit" ? (
          <Profit schoolId={schoolId} products={products} money={money} refreshKey={refreshKey} onError={setError} />
        ) : null}
      </Page>
    </div>
  );
};

export default Store;
