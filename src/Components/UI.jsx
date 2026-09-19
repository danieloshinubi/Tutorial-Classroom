import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "react-icons-kit";
import { chevronDown } from "react-icons-kit/feather/chevronDown";
import { chevronLeft } from "react-icons-kit/feather/chevronLeft";
import { chevronRight } from "react-icons-kit/feather/chevronRight";
import { check } from "react-icons-kit/feather/check";
import { calendar as calendarIcon } from "react-icons-kit/feather/calendar";

// Thin wrappers over the classes in styles/theme.css. Pages compose these so
// spacing, colour and radius stay consistent without repeating inline styles.

// The page frame.
//
// The heading, its subtitle, the primary action and anything passed as
// `toolbar` — tabs, a filter row, a term picker — stay put while the content
// under them scrolls. On a list of two hundred students you should not have to
// scroll back to the top to change a filter or read which tab you are on.
//
// The main region is the scroll container (see .shell in theme.css), so this
// is sticky within it rather than the window.
export const Page = ({ title, subtitle, action, toolbar, children, wide = false }) => {
  // Anything inside a page that also wants to stay put — a filter row, an
  // "add" form, a row of totals — has to sit below the page header rather
  // than under it. The header's height is not fixed (a subtitle wraps, a tab
  // strip appears), so it is measured and published as --page-top-h for
  // .panel-top and .panel-aside to use as their sticky offset.
  const pageRef = useRef(null);
  const topRef = useRef(null);

  // A layout effect, not a plain effect — a sticky descendant nested inside
  // its own layout container (a grid column, e.g. .panel-aside) can get its
  // browser-internal sticky constraints wrong if this variable is still
  // unset for that first painted frame and only arrives a tick later.
  // Publishing before paint means it's never unset for a real frame.
  useLayoutEffect(() => {
    const top = topRef.current;
    const page = pageRef.current;
    if (!top || !page || typeof ResizeObserver === "undefined") return undefined;

    const publish = () => {
      page.style.setProperty("--page-top-h", `${top.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(top);
    return () => observer.disconnect();
  });

  return (
  <div className={`page${wide ? " page-wide" : ""}`} ref={pageRef}>
    {(title || action || toolbar) && (
      <div className="page-top" ref={topRef}>
        {(title || action) && (
          <header className="page-head">
            <div>
              {title ? <h1>{title}</h1> : null}
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {action}
          </header>
        )}
        {toolbar ? <div className="page-toolbar">{toolbar}</div> : null}
      </div>
    )}
    <div className="page-body">{children}</div>
  </div>
  );
};

export const Card = ({ children, className = "", ...rest }) => (
  <div className={`card ${className}`} {...rest}>
    {children}
  </div>
);

export const Grid = ({ children, wide = false }) => (
  <div className={`grid${wide ? " wide" : ""}`}>{children}</div>
);

export const Section = ({ title, action, children }) => (
  <section className="section">
    {(title || action) && (
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h2>{title}</h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Button = ({ variant = "primary", size, className = "", ...props }) => (
  <button
    {...props}
    className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""} ${className}`}
  />
);

export const Field = ({ label, hint, children }) => (
  <label className="field">
    {label ? <span className="label">{label}</span> : null}
    {children}
    {hint ? <span className="hint">{hint}</span> : null}
  </label>
);

// A plain number input for an amount of money reads as a wall of digits —
// "3560000" takes a beat to parse as 3.56 million. This shows it with
// thousand separators as it's typed, while the value handed back through
// onChange stays a plain digits-and-one-decimal-point string, exactly what a
// numeric <input> would have given, so nothing downstream needs to change.
const formatMoneyDisplay = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return "";
  const [intPart, ...rest] = String(raw).replace(/[^\d.]/g, "").split(".");
  const withCommas = (intPart || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${withCommas}.${rest.join("")}` : withCommas;
};

export const MoneyInput = ({ value, onChange, className = "input", ...props }) => (
  <input
    {...props}
    type="text"
    inputMode="decimal"
    className={className}
    value={formatMoneyDisplay(value)}
    onChange={(e) => {
      const raw = e.target.value.replace(/,/g, "");
      if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
      onChange(raw);
    }}
  />
);

// A drop-in replacement for a native <select> whose open panel we can
// actually design — a browser's own option list ignores CSS almost
// entirely (the exact "Open/Pending/Resolved/Closed" popover with the
// system-grey highlight and no rounding that prompted this component), so
// getting a designed dropdown means building the listbox ourselves rather
// than styling a control we don't control the rendering of.
//
// `options` is a flat [{ value, label }] array — including a blank/"any"
// entry as a real option when a call site wants one, exactly like the
// <option value=""> it replaces. The trigger keeps whatever className the
// call site already passed (".select", ".tix-select full", ...) so its
// box — border, padding, radius, focus ring — stays the one already
// defined for that context; only the popup panel is new.
export const Select = ({
  value,
  onChange,
  options,
  className = "select",
  disabled = false,
  placeholder = "Select…",
  id,
  style,
  ...rest
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeAhead = useRef({ text: "", timer: null });
  // Picking an option removes the <li> that was actually clicked, mid
  // pointer-event, and at least on Chromium the click that follows gets
  // re-dispatched to whatever now sits under the cursor — reliably the
  // trigger button, which sits directly above the option list. Without
  // this guard that phantom click reopens the menu it just closed, so the
  // dropdown never visually goes away until an unrelated later click
  // lands outside it. Anything within this window after commit() is
  // treated as an echo of the same selection, not a fresh open request.
  const justClosedAtRef = useRef(0);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openMenu = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const commit = (index) => {
    const opt = options[index];
    setOpen(false);
    justClosedAtRef.current = performance.now();
    triggerRef.current?.focus();
    if (opt && opt.value !== value) onChange(opt.value);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        return;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIndex);
        return;
      case "Tab":
        setOpen(false);
        return;
      default: {
        if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
        const ref = typeAhead.current;
        clearTimeout(ref.timer);
        ref.text += e.key.toLowerCase();
        const match = options.findIndex((o) => String(o.label ?? "").toLowerCase().startsWith(ref.text));
        if (match >= 0) setActiveIndex(match);
        ref.timer = setTimeout(() => { ref.text = ""; }, 600);
      }
    }
  };

  return (
    <div className="uiselect" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${className} uiselect-trigger`}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-activedescendant={open && activeIndex >= 0 && id ? `${id}-opt-${activeIndex}` : undefined}
        onClick={() => {
          if (!open && performance.now() - justClosedAtRef.current < 400) return;
          open ? setOpen(false) : openMenu();
        }}
        onKeyDown={onKeyDown}
        {...rest}
      >
        <span className="uiselect-trigger-label">{selected ? selected.label : placeholder}</span>
        <Icon icon={chevronDown} size={15} className={`uiselect-caret${open ? " up" : ""}`} />
      </button>

      {open ? (
        <ul id={id ? `${id}-listbox` : undefined} className="uiselect-panel" role="listbox" ref={listRef}>
          {options.length === 0 ? (
            <li className="uiselect-empty">{"No options"}</li>
          ) : (
            options.map((opt, i) => (
              <li
                key={opt.value ?? i}
                id={id ? `${id}-opt-${i}` : undefined}
                role="option"
                aria-selected={opt.value === value}
                className={`uiselect-option${i === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(i)}
              >
                <span className="uiselect-option-label">{opt.label}</span>
                <Icon icon={check} size={14} className="uiselect-option-check" />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};

// ---- DatePicker's local date helpers — plain year/month/day math throughout,
// never Date.toISOString()/UTC parsing, which can shift a calendar date by a
// day depending on the viewer's timezone. A date here is always "the day the
// person meant," not an instant.
const isoToLocalDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const localDateToIso = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isSameDay = (a, b) =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

// A 12-year page, floored to a stable multiple of 12 so paging back and
// forth always lands on the same blocks (2020-2031, 2032-2043, ...)
// instead of a page whose range depends on whatever year it happened to
// start from.
const yearBlockStart = (year) => Math.floor(year / 12) * 12;
const buildYearGrid = (blockStart) => Array.from({ length: 12 }, (_, i) => blockStart + i);

// Re-stamps a date onto a different year, clamping the day so e.g. Feb 29
// on a leap year lands on Feb 28 rather than rolling into March.
const withYear = (date, year) => {
  const daysInMonth = new Date(year, date.getMonth() + 1, 0).getDate();
  return new Date(year, date.getMonth(), Math.min(date.getDate(), daysInMonth));
};

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Six-week-max grid, always a whole number of weeks — the same "no half rows"
// convention every real calendar widget uses, so partial weeks never look
// like a rendering bug.
const buildMonthGrid = (viewDate) => {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = firstWeekday; i > 0; i -= 1) {
    cells.push({ date: new Date(year, month, 1 - i), outside: true });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outside: true });
  }
  return cells;
};

// value/onChange for the time-aware variant carry "YYYY-MM-DDTHH:mm" — the
// exact shape a native <input type="datetime-local"> already used, so this
// is a drop-in swap at every call site, no parent-state format change.
const splitValue = (value) => {
  if (!value) return { datePart: null, timePart: null };
  const [datePart, timePart] = value.split("T");
  return { datePart, timePart: timePart || null };
};

const clampInt = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

const formatDateTimeValue = (date, hh, mm) => {
  const datePart = localDateToIso(date);
  return `${datePart}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

// Shared engine behind DatePicker and DateTimePicker — both are a drop-in
// replacement for a native <input type="date"> / <input type="datetime-local">
// whose popup has exactly the same problem a native <select> has: the OS
// renders it, not this app, so no CSS reaches it. Shaped like Select on
// purpose (a styled trigger + a custom popover, same --dd-* tokens for the
// panel itself) so a date field sitting next to a Select in the same form
// reads as one family of control, not two unrelated ones.
const BaseDatePicker = ({
  value,
  onChange,
  withTime = false,
  className = "input",
  disabled = false,
  placeholder,
  style,
  ...rest
}) => {
  const { datePart, timePart } = splitValue(value);
  const selected = isoToLocalDate(datePart);
  const [initialHh, initialMm] = timePart ? timePart.split(":").map(Number) : [null, null];

  const [open, setOpen] = useState(false);
  // "days" is the normal month grid; "years" is the quick-jump grid opened
  // by clicking the month/year label, for a birthdate or a school session
  // that's several years back — stepping month-by-month to get there is
  // exactly the friction this mode skips.
  const [pickerMode, setPickerMode] = useState("days");
  const [yearsStart, setYearsStart] = useState(() => yearBlockStart((selected || new Date()).getFullYear()));
  const [viewDate, setViewDate] = useState(() => startOfMonth(selected || new Date()));
  const [focusedDate, setFocusedDate] = useState(() => selected || new Date());
  // Only meaningful when withTime — the draft day + time-of-day being built
  // up in the open panel before "Set" commits them together. A plain date
  // has no such draft: clicking a day commits immediately, same as before.
  const [draftDate, setDraftDate] = useState(() => selected || new Date());
  const [hours, setHours] = useState(() => (initialHh != null ? initialHh : new Date().getHours()));
  const [minutes, setMinutes] = useState(() => (initialMm != null ? initialMm : 0));
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keeps real DOM focus following the roving tabIndex day cell, so arrow-
  // key navigation and Tab both land in the same place a mouse click would.
  // Only meaningful in the day grid — the year grid has no roving focus.
  useEffect(() => {
    if (!open || pickerMode !== "days") return;
    const el = gridRef.current?.querySelector(`[data-date="${localDateToIso(focusedDate)}"]`);
    el?.focus();
  }, [open, pickerMode, focusedDate, viewDate]);

  const openPanel = () => {
    const base = selected || focusedDate || new Date();
    setPickerMode("days");
    setViewDate(startOfMonth(base));
    setFocusedDate(base);
    setDraftDate(base);
    setHours(initialHh != null ? initialHh : new Date().getHours());
    setMinutes(initialMm != null ? initialMm : 0);
    setOpen(true);
  };

  const openYearPicker = () => {
    setYearsStart(yearBlockStart(viewDate.getFullYear()));
    setPickerMode("years");
  };

  const pickYear = (year) => {
    const next = withYear(focusedDate, year);
    setViewDate(startOfMonth(next));
    setFocusedDate(next);
    if (withTime) setDraftDate(next);
    setPickerMode("days");
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commitDate = (date) => {
    onChange(localDateToIso(date));
    close();
  };

  const commitDateTime = () => {
    onChange(formatDateTimeValue(draftDate, hours, minutes));
    close();
  };

  const pickDay = (date) => {
    if (withTime) {
      setFocusedDate(date);
      setDraftDate(date);
    } else {
      commitDate(date);
    }
  };

  const clear = () => {
    onChange("");
    close();
  };

  const moveFocus = (days) => {
    setFocusedDate((current) => {
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + days);
      if (next.getMonth() !== viewDate.getMonth() || next.getFullYear() !== viewDate.getFullYear()) {
        setViewDate(startOfMonth(next));
      }
      if (withTime) setDraftDate(next);
      return next;
    });
  };

  const shiftMonth = (delta) => {
    setFocusedDate((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, current.getDate());
      setViewDate(startOfMonth(next));
      return next;
    });
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (pickerMode === "years") {
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerMode("days");
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        return;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-7);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(7);
        return;
      case "PageUp":
        e.preventDefault();
        shiftMonth(-1);
        return;
      case "PageDown":
        e.preventDefault();
        shiftMonth(1);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        pickDay(focusedDate);
        return;
      default:
    }
  };

  const cells = buildMonthGrid(viewDate);
  const today = new Date();
  const highlightDate = withTime ? draftDate : selected;

  const triggerLabel = () => {
    if (withTime) {
      if (!selected) return placeholder || "Select a date and time";
      return `${selected.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${String(initialHh ?? 0).padStart(2, "0")}:${String(initialMm ?? 0).padStart(2, "0")}`;
    }
    return selected
      ? selected.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : placeholder || "Select a date";
  };

  return (
    <div className="uidate" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${className} uidate-trigger`}
        style={style}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        <span className="uidate-trigger-label">{triggerLabel()}</span>
        <Icon icon={calendarIcon} size={15} className="uidate-icon" />
      </button>

      {open ? (
        <div className="uidate-panel" role="dialog" aria-label={withTime ? "Choose a date and time" : "Choose a date"}>
          <div className="uidate-nav">
            <button
              type="button"
              className="uidate-nav-btn"
              onClick={() => (pickerMode === "years" ? setYearsStart((y) => y - 12) : shiftMonth(-1))}
              aria-label={pickerMode === "years" ? "Previous years" : "Previous month"}
            >
              <Icon icon={chevronLeft} size={15} />
            </button>
            {pickerMode === "years" ? (
              <button type="button" className="uidate-nav-label uidate-nav-label-btn" onClick={() => setPickerMode("days")}>
                {`${yearsStart}–${yearsStart + 11}`}
              </button>
            ) : (
              <button
                type="button"
                className="uidate-nav-label uidate-nav-label-btn"
                onClick={openYearPicker}
                title="Jump to a year"
              >
                {viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </button>
            )}
            <button
              type="button"
              className="uidate-nav-btn"
              onClick={() => (pickerMode === "years" ? setYearsStart((y) => y + 12) : shiftMonth(1))}
              aria-label={pickerMode === "years" ? "Next years" : "Next month"}
            >
              <Icon icon={chevronRight} size={15} />
            </button>
          </div>

          {pickerMode === "years" ? (
            <div className="uidate-yeargrid">
              {buildYearGrid(yearsStart).map((year) => (
                <button
                  key={year}
                  type="button"
                  className={`uidate-year${year === viewDate.getFullYear() ? " selected" : ""}${year === today.getFullYear() ? " today" : ""}`}
                  onClick={() => pickYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="uidate-weekdays">
                {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
              </div>

              <div className="uidate-grid" ref={gridRef} onKeyDown={handleKeyDown}>
                {cells.map(({ date, outside }) => {
                  const iso = localDateToIso(date);
                  const isFocused = isSameDay(date, focusedDate);
                  return (
                    <button
                      key={iso}
                      type="button"
                      data-date={iso}
                      tabIndex={isFocused ? 0 : -1}
                      className={`uidate-day${outside ? " outside" : ""}${isSameDay(date, highlightDate) ? " selected" : ""}${isSameDay(date, today) ? " today" : ""}`}
                      onClick={() => pickDay(date)}
                      onFocus={() => setFocusedDate(date)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {pickerMode === "days" && withTime ? (
            <div className="uidate-time">
              <span className="uidate-time-label">{"Time"}</span>
              <div className="uidate-time-inputs">
                <input
                  type="number"
                  className="uidate-time-num"
                  min={0}
                  max={23}
                  value={String(hours).padStart(2, "0")}
                  onChange={(e) => setHours(clampInt(parseInt(e.target.value, 10), 0, 23))}
                  aria-label="Hour"
                />
                <span className="uidate-time-sep">{":"}</span>
                <input
                  type="number"
                  className="uidate-time-num"
                  min={0}
                  max={59}
                  value={String(minutes).padStart(2, "0")}
                  onChange={(e) => setMinutes(clampInt(parseInt(e.target.value, 10), 0, 59))}
                  aria-label="Minute"
                />
              </div>
            </div>
          ) : null}

          {pickerMode === "days" ? (
          <div className="uidate-footer">
            {withTime ? (
              <>
                <button type="button" className="uidate-link" onClick={() => setDraftDate(new Date())}>{"Today"}</button>
                <span className="uidate-footer-spacer" />
                {value ? (
                  <button type="button" className="uidate-link muted" onClick={clear}>{"Clear"}</button>
                ) : null}
                <button type="button" className="btn btn-primary btn-sm" onClick={commitDateTime}>{"Set"}</button>
              </>
            ) : (
              <>
                <button type="button" className="uidate-link" onClick={() => commitDate(new Date())}>{"Today"}</button>
                {value ? (
                  <button type="button" className="uidate-link muted" onClick={clear}>{"Clear"}</button>
                ) : null}
              </>
            )}
          </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const DatePicker = (props) => <BaseDatePicker {...props} withTime={false} />;
export const DateTimePicker = (props) => <BaseDatePicker {...props} withTime />;

export const Badge = ({ children, tone }) => (
  <span className={`badge${tone ? ` ${tone}` : ""}`}>{children}</span>
);

export const Notice = ({ tone = "muted", children }) =>
  children ? <p className={`notice ${tone}`}>{children}</p> : null;

// A centred overlay dialog — title, an optional one-line subtitle, whatever
// content the caller wants, then a footer for its action buttons. Nothing
// in this codebase had a shared modal before this; every "view/edit one
// record" flow was either a full page or a window.confirm(). Introduced for
// the platform console's own record-level actions (approve, extend a
// trial, review a single admin) — the same two-button footer shape (a
// primary action, an outlined caution/danger one beside it) as approving or
// rejecting a single record anywhere else that pattern shows up.
export const Modal = ({ title, subtitle, onClose, children, footer, wide = false }) => (
  <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true">
      <div className="modal-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {onClose ? (
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            {"✕"}
          </button>
        ) : null}
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
    </div>
  </div>
);

// The light, mint-tinted checklist box the platform console's own review
// modals use for "here's a set of things to check off" — a group label plus
// its checkboxes, visually set apart from the rest of the modal's body.
export const ChecklistBox = ({ title, children }) => (
  <div className="checklist-box">
    {title ? <div className="checklist-box-title">{title}</div> : null}
    {children}
  </div>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// ---- Skeleton loaders --------------------------------------------------
// One shape per thing a page is about to show — a stat tile, a table row, a
// card, a list row — so loading reads as "the page is arriving" instead of
// a spinner or a bare "Loading..." string with no sense of what's coming.
// `aria-hidden` throughout: a screen reader has nothing useful to read out
// of a shape that isn't there yet; `role="status"`/label lives on whichever
// wrapper the page itself already announces loading with.

// A single block — a line of text, an avatar, anything rectangular.
// `width` takes any CSS width (e.g. "60%", "120px"); defaults fill their container.
export const Skeleton = ({ width, height = 14, radius, style, className = "" }) => (
  <span
    aria-hidden="true"
    className={`skeleton ${className}`}
    style={{ width: width ?? "100%", height, borderRadius: radius, ...style }}
  />
);

// Stacked lines of decreasing width — reads like a paragraph or a heading
// plus caption, rather than identical bars.
export const SkeletonText = ({ lines = 3, lastLineWidth = "60%" }) => (
  <div className="skeleton-text" aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} width={i === lines - 1 ? lastLineWidth : "100%"} />
    ))}
  </div>
);

// Matches StatRow's own .stat-row/.stat grid exactly, so the transition
// from skeleton to real numbers doesn't shift the layout at all.
export const SkeletonStatRow = ({ count = 4 }) => (
  <div className="skeleton-stat-row" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-stat">
        <Skeleton width="50%" height={12} />
        <Skeleton width="70%" height={24} />
      </div>
    ))}
  </div>
);

// Matches table.data's own row height/padding — drop straight in wherever
// a page currently renders <Empty>{"Loading..."}</Empty> in place of a
// <table class="data">.
export const SkeletonTable = ({ rows = 5, cols = 4 }) => (
  <div className="table-wrap" aria-hidden="true">
    <table className="data">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}><Skeleton /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// A grid of card-shaped blocks — for a page whose loaded content is a
// .grid of .card elements (feature/summary cards, not a table).
export const SkeletonCards = ({ count = 4, lines = 2 }) => (
  <div className="skeleton-card-grid" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-card">
        <Skeleton width="60%" height={16} />
        <SkeletonText lines={lines} />
      </div>
    ))}
  </div>
);

// A vertical list of avatar+text rows — notices, chat messages, tickets,
// anything that reads top-to-bottom as one item per row rather than a table.
export const SkeletonList = ({ rows = 4, avatar = true }) => (
  <div aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton-list-row">
        {avatar ? <Skeleton width={34} height={34} radius={999} style={{ flex: "none" }} /> : null}
        <SkeletonText lines={2} lastLineWidth="40%" />
      </div>
    ))}
  </div>
);

// A row of tabs that can outgrow its width — School Administration alone has
// nine of them. Rather than leave the browser's own scrollbar as the only
// sign there's more, this tracks which edge still has something to scroll to
// and fades that edge + offers a click target there, the way a horizontally-
// scrolling row should read instead of looking like it got cut off.
export const Tabs = ({ tabs, active, onChange }) => {
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateEdges = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useLayoutEffect(() => {
    updateEdges();
  }, [tabs]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, []);

  // The active tab can change from outside a click — a ?tab= query param, a
  // link from elsewhere in the app — so keep it in view then too, not only
  // when the user themselves clicked something already visible.
  useEffect(() => {
    trackRef.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const scrollBy = (direction) => {
    trackRef.current?.scrollBy({ left: direction * Math.round(trackRef.current.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div
      className={`tabs-wrap${canScrollLeft ? " can-scroll-left" : ""}${canScrollRight ? " can-scroll-right" : ""}`}
    >
      {canScrollLeft ? (
        <button type="button" className="tabs-scroll-btn left" onClick={() => scrollBy(-1)} aria-label="Scroll tabs left">
          <Icon icon={chevronLeft} size={15} />
        </button>
      ) : null}
      <div className="tabs" ref={trackRef}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab${active === tab.id ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {canScrollRight ? (
        <button type="button" className="tabs-scroll-btn right" onClick={() => scrollBy(1)} aria-label="Scroll tabs right">
          <Icon icon={chevronRight} size={15} />
        </button>
      ) : null}
    </div>
  );
};

// Gives each course a stable colour from its code, so tiles look varied
// without being random on every render.
export const bandClass = (seed = "") => {
  const variants = ["", " alt", " alt2", " alt3"];
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return `tile-band${variants[total % variants.length]}`;
};

// Prefers a real name, then the username, then the local part of the email —
// never the whole address, which used to overflow the header.
export const displayName = (profile) => {
  if (!profile) return "Someone";
  const full = `${profile.first_name || ""} ${profile.surname || ""}`.trim();
  if (full) return full;
  if (profile.username) return profile.username;
  if (profile.email) return profile.email.split("@")[0];
  return "Someone";
};

export const initials = (profile) => {
  const name = displayName(profile);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
};

export const formatDate = (value, { withTime = true, fallback = "No due date" } = {}) => {
  if (!value) return fallback;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
};
