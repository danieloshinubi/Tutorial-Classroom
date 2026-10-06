import React, { useMemo, useRef, useState } from "react";
import { isGroup, type Address, type DirectoryEntry } from "../../lib/mailApi";
import { Initials } from "./mailUi";

// To, Cc or Bcc: people as removable chips, suggestions from the school's
// staff as you type, and any address typed or pasted in (separated by
// commas, semicolons or new lines). An address that is not valid shows red.
// A group (All staff, a role, one of your own, supabase/241) is one chip and
// is opened up into its people when the message is sent.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const parse = (text: string, people: DirectoryEntry[]): Address[] =>
  text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
      const address = (m ? m[2] : part).trim().toLowerCase();
      const known = people.find((p) => p.address === address);
      return { name: (m ? m[1].trim() : "") || known?.name || "", address };
    });

const RecipientField = ({
  label,
  value,
  onChange,
  people,
  autoFocus,
  trailing,
}: {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  people: DirectoryEntry[];
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}) => {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    const taken = new Set(value.map((v) => v.address));
    return people
      .filter((p) => !taken.has(p.address) && (p.name.toLowerCase().includes(needle) || p.address.includes(needle)))
      .slice(0, 8);
  }, [text, people, value]);

  const add = (list: Address[]) => {
    const seen = new Set(value.map((v) => v.address));
    const fresh = list.filter((a) => a.address && !seen.has(a.address) && (seen.add(a.address), true));
    if (fresh.length) onChange([...value, ...fresh]);
    setText("");
    setActive(0);
  };

  const commit = () => {
    if (text.trim()) add(parse(text, people));
  };

  return (
    <div data-recipients className="tw-relative tw-flex tw-items-start tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-py-1.5">
      <span className="tw-w-10 tw-shrink-0 tw-pt-1.5 tw-text-[13.5px] tw-text-ink-3">{label}</span>
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-wrap tw-items-center tw-gap-1.5" onClick={() => inputRef.current?.focus()}>
        {value.map((a) => {
          const bad = !isGroup(a.address) && !EMAIL.test(a.address);
          const group = isGroup(a.address);
          return (
            <span
              key={a.address}
              title={a.address}
              className={`tw-inline-flex tw-max-w-full tw-items-center tw-gap-1.5 tw-rounded-full tw-py-0.5 tw-pl-0.5 tw-pr-1.5 tw-text-[13px] ${
                bad ? "tw-bg-danger-soft tw-text-danger" : "tw-bg-brand-soft tw-text-ink"
              }`}
            >
              {group ? (
                <span className="tw-inline-flex tw-h-5 tw-w-5 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand tw-text-[10px] tw-font-bold tw-text-white">{"G"}</span>
              ) : (
                <Initials name={a.name} address={a.address} size={20} />
              )}
              <span className="tw-truncate">{a.name || a.address}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name || a.address}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v.address !== a.address));
                }}
                className="tw-inline-flex tw-h-4 tw-w-4 tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent tw-p-0 tw-text-[14px] tw-leading-none tw-text-ink-3 tw-cursor-pointer hover:tw-text-danger [font-family:inherit]"
              >
                {"×"}
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
            commit();
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[,;\n]/.test(pasted)) {
              e.preventDefault();
              add(parse(pasted, people));
            }
          }}
          onKeyDown={(e) => {
            if (open && suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && open && suggestions[active] && text.trim()) {
              e.preventDefault();
              add([{ name: suggestions[active].name, address: suggestions[active].address }]);
            } else if (e.key === "Enter" || e.key === "," || e.key === ";") {
              if (text.trim()) {
                e.preventDefault();
                commit();
              }
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="tw-min-w-[140px] tw-flex-1 tw-border-0 tw-bg-transparent tw-py-1 tw-text-[14px] tw-text-ink tw-outline-none [font-family:inherit]"
        />
      </div>
      {trailing}
      {open && suggestions.length ? (
        <ul className="tw-absolute tw-left-12 tw-right-0 tw-top-full tw-z-[60] tw-m-0 tw-mt-1 tw-max-h-72 tw-list-none tw-overflow-y-auto tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-1 tw-shadow-3">
          {suggestions.map((p, i) => (
            <li key={p.address}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add([{ name: p.name, address: p.address }]);
                }}
                className={`tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-lg tw-border-0 tw-px-2.5 tw-py-2 tw-text-left tw-cursor-pointer [font-family:inherit] ${i === active ? "tw-bg-brand-soft" : "tw-bg-transparent hover:tw-bg-bg"}`}
              >
                {p.avatar_url ? <img src={p.avatar_url} alt="" className="tw-h-8 tw-w-8 tw-rounded-full tw-object-cover" /> : <Initials name={p.name} address={p.address} size={32} />}
                <span className="tw-flex tw-min-w-0 tw-flex-col">
                  <span className="tw-truncate tw-text-[14px] tw-font-semibold tw-text-ink">{p.name}</span>
                  <span className="tw-truncate tw-text-[12.5px] tw-text-ink-3">{[p.job_title, p.address].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export default RecipientField;
