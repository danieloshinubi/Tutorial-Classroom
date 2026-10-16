import React, { useEffect, useState } from "react";

// The one loading state for the whole app (2026-10-16), replacing the grey
// placeholder cards and the bare "Loading..." lines. A slim line in the
// school's colour slides along a quiet track, with a short word beneath.
//
// It only appears after a quarter of a second: most screens load faster than
// that, and then nothing flickers at all.
const Loading = ({ label = "Loading", compact = false }: { label?: string; compact?: boolean }) => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 250);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`tw-flex tw-w-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-transition-opacity tw-duration-300 ${
        compact ? "tw-py-6" : "tw-py-20"
      } ${shown ? "tw-opacity-100" : "tw-opacity-0"}`}
    >
      <span aria-hidden="true" className="tw-relative tw-block tw-h-[3px] tw-w-[132px] tw-overflow-hidden tw-rounded-full tw-bg-line">
        <span className="app-loader-fill tw-absolute tw-inset-y-0 tw-left-0 tw-w-[42%] tw-rounded-full tw-bg-brand" />
      </span>
      <span className="tw-text-[12.5px] tw-font-medium tw-tracking-[0.02em] tw-text-ink-3">{label}</span>
    </div>
  );
};

export default Loading;
