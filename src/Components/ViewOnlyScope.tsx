import React, { useEffect, useRef, type ReactNode } from "react";
import { useToast } from "./Toast";

// A module opened as View only (School admin → People → Module access,
// supabase/230): the page works for looking, never for changing. Mounted by
// SchoolRoute around the module's page.
//
//   - every form on the page, and in any window the page opens (.modal), is
//     made read-only (inert) and cannot be submitted;
//   - the buttons that change things are hidden: the main action buttons
//     (Save, Add, Create, Mark, Publish...) and delete buttons;
//   - switches cannot be flipped.
//
// Searching, filters, tabs, links, "See detail" and exports keep working.
// For the money and admissions modules the database refuses changes too.

const FROZEN = "form, [role=switch], .switch";

const ViewOnlyScope = ({ children, label }: { children?: ReactNode; label: string }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const { notify } = useToast();

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    document.body.classList.add("view-only-active");

    const inScope = (el: Element | null) => Boolean(el && (root.contains(el) || el.closest(".modal")));
    const freeze = () => {
      const targets = [...Array.from(root.querySelectorAll(FROZEN)), ...Array.from(document.querySelectorAll(`.modal ${FROZEN.split(", ").join(", .modal ")}`))];
      targets.forEach((el) => {
        if (!el.hasAttribute("inert") && !el.closest("[data-view-only-ok]")) el.setAttribute("inert", "");
      });
    };
    freeze();
    const watch = new MutationObserver(freeze);
    watch.observe(document.body, { subtree: true, childList: true });

    const block = (e: Event) => {
      const form = e.target as Element | null;
      if (!inScope(form) || form?.closest("[data-view-only-ok]")) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        notify(`View only: you can look around ${label}, but not change anything.`, { tone: "info" });
      } catch {
        // no toast available; the change is still blocked
      }
    };
    document.addEventListener("submit", block, true);

    return () => {
      watch.disconnect();
      document.removeEventListener("submit", block, true);
      document.body.classList.remove("view-only-active");
    };
  }, [label, notify]);

  return (
    <div ref={ref} className="view-only-scope">
      {children}
    </div>
  );
};

export default ViewOnlyScope;
