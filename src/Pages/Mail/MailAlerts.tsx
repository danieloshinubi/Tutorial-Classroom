import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ICON, Svg } from "./mailUi";

// The moment someone opens your mail (supabase/241): a card pops up wherever
// you are in Schoolivio, the way GoDaddy's Titan does it. It comes from the
// "mail_opened" notification as it arrives live (the bell and a push to the
// phone carry the same notification). Notifications.jsx hands each new mail
// notification over with showMailAlert().

interface Alert {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
}

const EVENT = "schoolivio:mail-alert";

export function showMailAlert(a: Alert) {
  window.dispatchEvent(new CustomEvent<Alert>(EVENT, { detail: a }));
}

const MailAlerts = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<Alert>).detail;
      setAlerts((list) => (list.some((x) => x.id === a.id) ? list : [...list.slice(-3), a]));
      window.setTimeout(() => setAlerts((list) => list.filter((x) => x.id !== a.id)), 9000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  if (!alerts.length) return null;
  return (
    <div className="tw-fixed tw-bottom-5 tw-right-5 tw-z-[190] tw-flex tw-w-[340px] tw-max-w-[calc(100vw-24px)] tw-flex-col tw-gap-2 mobile:tw-bottom-3 mobile:tw-right-3" role="status" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.id} className="tw-flex tw-items-start tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-3 tw-shadow-3">
          <span className="tw-mt-0.5 tw-inline-flex tw-h-8 tw-w-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-success-soft tw-text-success">
            <Svg d={a.kind === "mail_opened" ? ICON.eye : ICON.envelope} size={16} />
          </span>
          <button
            type="button"
            onClick={() => {
              setAlerts((list) => list.filter((x) => x.id !== a.id));
              if (a.link) navigate(a.link);
            }}
            className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-border-0 tw-bg-transparent tw-p-0 tw-text-left tw-cursor-pointer [font-family:inherit]"
          >
            <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{a.title}</span>
            {a.body ? <span className="tw-truncate tw-text-[13px] tw-text-ink-2">{a.body}</span> : null}
            <span className="tw-text-[12px] tw-text-ink-3">{"Just now"}</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setAlerts((list) => list.filter((x) => x.id !== a.id))}
            className="tw-inline-flex tw-h-6 tw-w-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded tw-border-0 tw-bg-transparent tw-text-ink-3 tw-cursor-pointer hover:tw-bg-bg"
          >
            <Svg d={ICON.close} size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default MailAlerts;
