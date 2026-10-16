import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// A page's tab, view or filter, kept in the address (?tab=midexams) instead
// of only in memory (2026-10-16). Reloading the page, going back to it, or
// sharing the link then lands exactly where the person was, not on the first
// tab. The default value is left out of the address so links stay clean.
//
//   const [tab, setTab] = useUrlState("tab", "stream", TAB_IDS);
export const useUrlState = <T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (next: T) => void] => {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : fallback) as T;

  const set = useCallback(
    (next: T) => {
      // Built from the address as it is right now, so two of these called one
      // after the other (a folder and a filter) both stick.
      const p = new URLSearchParams(window.location.search);
      if (next === fallback) p.delete(key);
      else p.set(key, next);
      setParams(p, { replace: true });
    },
    [key, fallback, setParams],
  );

  return [value, set];
};
