import React, { useMemo, useState } from "react";
import { Select } from "./UI";
import {
  countryName,
  countryOptions,
  currencyForCountry,
  currencyLabel,
  currencyName,
  currencyOptions,
  timeZoneOptions,
  type DetectedLocale,
} from "../lib/currencies";

// The school's country, currency and time zone (supabase/226, 227). The
// currency is what it bills parents, sells and pays salaries in; the country
// decides which statutory pay rules payroll starts with. Used on
// schoolivio.com's "Start free trial", the console's "New school", and
// School admin → School settings.

export const CurrencySelect = ({ value, onChange, id }: { value: string; onChange: (code: string) => void; id?: string }) => {
  const options = useMemo(() => currencyOptions(), []);
  return <Select id={id} value={value} onChange={onChange} options={options} searchable />;
};

export const CountrySelect = ({
  value,
  onChange,
  id,
}: {
  value: string | null;
  onChange: (code: string) => void;
  id?: string;
}) => {
  const options = useMemo(() => countryOptions(), []);
  return <Select id={id} value={value || ""} onChange={onChange} options={options} placeholder="Choose a country" searchable />;
};

export const TimeZoneSelect = ({ value, onChange, id }: { value: string; onChange: (zone: string) => void; id?: string }) => {
  const options = useMemo(() => timeZoneOptions(), []);
  return <Select id={id} value={value} onChange={onChange} options={options} searchable />;
};

export interface LocaleChoice {
  country: string | null;
  currency: string;
}

// Asks before using the country the device seems to be in, and its currency:
// "It looks like you are in Canada, which uses the Canadian Dollar (CAD).
// Should this school bill parents, sell and pay salaries in it?" Yes keeps
// both; No opens the country and currency lists (picking a country fills in
// its currency, which can still be changed).
export const LocaleConfirm = ({
  detected,
  value,
  onChange,
  onDecided,
}: {
  detected: DetectedLocale;
  value: LocaleChoice;
  onChange: (next: LocaleChoice) => void;
  /** Called once the person has answered Yes or No. */
  onDecided?: () => void;
}) => {
  const [answer, setAnswer] = useState<"ask" | "yes" | "choose">(detected.country ? "ask" : "choose");

  if (answer === "ask" && detected.country) {
    return (
      <div className="currency-confirm" role="group" aria-label="Confirm country and currency">
        <p>
          {"It looks like you are in "}
          <strong>{countryName(detected.country)}</strong>
          {", which uses the "}
          <strong>{currencyName(detected.currency)}</strong>
          {` (${detected.currency}). Should this school bill parents, sell and pay salaries in it?`}
        </p>
        <div className="currency-confirm-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onChange({ country: detected.country, currency: detected.currency });
              setAnswer("yes");
              onDecided?.();
            }}
          >
            {`Yes, use ${detected.currency}`}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setAnswer("choose");
              onDecided?.();
            }}
          >
            {"No, choose another"}
          </button>
        </div>
      </div>
    );
  }

  if (answer === "yes") {
    return (
      <div className="currency-confirm is-chosen">
        <span>{`${value.country ? `${countryName(value.country)} · ` : ""}${currencyLabel(value.currency)}`}</span>
        <button type="button" className="currency-confirm-change" onClick={() => setAnswer("choose")}>
          {"Change"}
        </button>
      </div>
    );
  }

  return (
    <div className="locale-choose">
      <label className="locale-choose-label">{"Country"}</label>
      <CountrySelect
        value={value.country}
        onChange={(country) => onChange({ country, currency: currencyForCountry(country) || value.currency })}
      />
      <label className="locale-choose-label">{"Currency"}</label>
      <CurrencySelect value={value.currency} onChange={(currency) => onChange({ ...value, currency })} />
    </div>
  );
};
