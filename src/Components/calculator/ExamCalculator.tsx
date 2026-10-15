import React, { Suspense, lazy, useEffect, useState } from "react";
import ErrorBoundary from "../ErrorBoundary";

// The calculator on an exam: a large, labelled button that opens it, and the
// calculator itself, loaded only when first opened. Hiding it keeps its
// memory, answers and mode, as switching a real one off and on would not.
const load = () => import("./NaturalCalculator");
const NaturalCalculator = lazy(load);

const ExamCalculator = () => {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  // Fetched as soon as the exam page opens, while the connection is known to
  // be good, so opening it later works even offline or after a new release.
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  return (
    <>
      {loaded ? (
        // A calculator that fails to load says so; it never takes the paper
        // down with it.
        <ErrorBoundary
          fallback={(retry) =>
            open ? (
              <div role="alert" className="tw-fixed tw-bottom-5 tw-right-5 tw-z-[70] tw-flex tw-max-w-[320px] tw-flex-col tw-gap-2 tw-rounded-2xl tw-bg-surface tw-p-4 tw-text-[14px] tw-text-ink tw-shadow-[0_10px_28px_rgba(0,0,0,0.25)]">
                <strong>{"The calculator could not open."}</strong>
                <span className="tw-text-ink-2">{"Your answers are safe. Check your connection and try again."}</span>
                <span className="tw-flex tw-gap-2">
                  <button type="button" onClick={retry} className="tw-cursor-pointer tw-rounded-full tw-border-0 tw-bg-brand tw-px-4 tw-py-1.5 tw-font-semibold tw-text-white [font-family:inherit]">{"Try again"}</button>
                  <button type="button" onClick={() => setOpen(false)} className="tw-cursor-pointer tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-transparent tw-px-4 tw-py-1.5 tw-font-semibold tw-text-ink [font-family:inherit]">{"Close"}</button>
                </span>
              </div>
            ) : null
          }
        >
          <Suspense fallback={null}>
            <NaturalCalculator hidden={!open} onClose={() => setOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {open ? null : (
        <button
          type="button"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          className="tw-fixed tw-bottom-5 tw-right-5 tw-z-[60] tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-2.5 tw-rounded-full tw-border-0 tw-bg-brand tw-py-3.5 tw-pl-4 tw-pr-6 tw-text-[16px] tw-font-bold tw-text-white tw-shadow-[0_10px_28px_rgba(0,0,0,0.28)] hover:tw-opacity-95 mobile:tw-bottom-4 mobile:tw-right-4 [font-family:inherit]"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <rect x="7" y="5" width="10" height="4" rx="1" />
            <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" strokeWidth="2.6" />
          </svg>
          {"Calculator"}
        </button>
      )}
    </>
  );
};

export default ExamCalculator;
