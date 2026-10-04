// The currency a school bills parents, sells and pays salaries in, and its
// time zone (supabase/226), chosen from every one the browser knows and named
// in the reader's language ("Canadian Dollar (CAD · $)"), so Schoolivio works
// for a school anywhere. The short lists below only stand in for very old
// browsers.

const FALLBACK_CURRENCIES = [
  "NGN", "GHS", "KES", "UGX", "TZS", "RWF", "ZAR", "XOF", "XAF", "EGP", "MAD", "ETB", "ZMW",
  "USD", "GBP", "EUR", "CAD", "AUD", "NZD", "INR", "PKR", "BDT", "PHP", "AED", "SAR", "JPY", "CNY", "BRL", "MXN",
];
const FALLBACK_ZONES = [
  "Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Africa/Kampala",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Karachi", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

type IntlWithValues = typeof Intl & { supportedValuesOf?: (key: string) => string[] };
const supported = (key: string, fallback: string[]) => {
  try {
    const list = (Intl as IntlWithValues).supportedValuesOf?.(key);
    return list && list.length ? list : fallback;
  } catch {
    return fallback;
  }
};

export const currencyName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) || code;
  } catch {
    return code;
  }
};

export const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
};

export const currencySymbol = (code: string) => {
  try {
    const part = new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part && part.value !== code ? part.value : "";
  } catch {
    return "";
  }
};

export const currencyLabel = (code: string) => {
  const sym = currencySymbol(code);
  return `${currencyName(code)} (${code}${sym ? ` · ${sym}` : ""})`;
};

// The most common choices first, then everything else A–Z.
const FIRST = ["NGN", "GHS", "KES", "ZAR", "USD", "CAD", "GBP", "EUR"];

let currencyCache: { value: string; label: string }[] | null = null;
export const currencyOptions = () => {
  if (currencyCache) return currencyCache;
  const all = Array.from(new Set([...supported("currency", FALLBACK_CURRENCIES), ...FALLBACK_CURRENCIES]));
  const option = (code: string) => ({ value: code, label: currencyLabel(code) });
  const rest = all.filter((c) => !FIRST.includes(c)).map(option).sort((a, b) => a.label.localeCompare(b.label));
  currencyCache = [...FIRST.map(option), ...rest];
  return currencyCache;
};

let zoneCache: { value: string; label: string }[] | null = null;
export const timeZoneOptions = () => {
  if (zoneCache) return zoneCache;
  const all = Array.from(new Set([...supported("timeZone", FALLBACK_ZONES), "UTC"]));
  zoneCache = all.sort().map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  return zoneCache;
};

// Where the person creating the school seems to be, from their device alone
// (no location permission, nothing sent anywhere). The time zone names a
// country far more reliably than the language setting, which is en-US on half
// the phones in the world. The form then asks them to confirm that country's
// currency (CurrencyConfirm) rather than choosing it silently.
const ZONE_COUNTRY: Record<string, string> = {
  "Africa/Lagos": "NG", "Africa/Accra": "GH", "Africa/Nairobi": "KE", "Africa/Kampala": "UG", "Africa/Dar_es_Salaam": "TZ",
  "Africa/Kigali": "RW", "Africa/Johannesburg": "ZA", "Africa/Cairo": "EG", "Africa/Casablanca": "MA", "Africa/Addis_Ababa": "ET",
  "Africa/Lusaka": "ZM", "Africa/Douala": "CM", "Africa/Dakar": "SN", "Africa/Abidjan": "CI", "Africa/Porto-Novo": "BJ",
  "Africa/Lome": "TG", "Africa/Ouagadougou": "BF", "Africa/Bamako": "ML", "Africa/Niamey": "NE", "Africa/Libreville": "GA",
  "Africa/Monrovia": "LR", "Africa/Freetown": "SL", "Africa/Banjul": "GM", "Africa/Blantyre": "MW", "Africa/Harare": "ZW",
  "Africa/Gaborone": "BW", "Africa/Windhoek": "NA", "Africa/Maputo": "MZ", "Africa/Luanda": "AO", "Africa/Khartoum": "SD",
  "Africa/Kinshasa": "CD", "Africa/Lubumbashi": "CD", "Africa/Tunis": "TN", "Africa/Algiers": "DZ", "Africa/Tripoli": "LY",
  "Africa/Mogadishu": "SO", "Africa/Djibouti": "DJ", "Africa/Asmara": "ER", "Africa/Juba": "SS", "Africa/Bujumbura": "BI",
  "Africa/Maseru": "LS", "Africa/Mbabane": "SZ", "Indian/Mauritius": "MU", "Indian/Antananarivo": "MG", "Atlantic/Cape_Verde": "CV",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL", "Europe/Lisbon": "PT", "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Vienna": "AT",
  "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ", "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Athens": "GR", "Europe/Istanbul": "TR",
  "Europe/Kyiv": "UA", "Europe/Kiev": "UA", "Europe/Moscow": "RU",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US",
  "America/Anchorage": "US", "Pacific/Honolulu": "US", "America/Detroit": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Halifax": "CA",
  "America/St_Johns": "CA", "America/Regina": "CA",
  "America/Mexico_City": "MX", "America/Sao_Paulo": "BR", "America/Argentina/Buenos_Aires": "AR", "America/Bogota": "CO",
  "America/Lima": "PE", "America/Santiago": "CL", "America/Jamaica": "JM", "America/Port_of_Spain": "TT", "America/Barbados": "BB",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Muscat": "OM",
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Asia/Kathmandu": "NP", "Asia/Colombo": "LK",
  "Asia/Manila": "PH", "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID", "Asia/Bangkok": "TH",
  "Asia/Ho_Chi_Minh": "VN", "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK",
  "Asia/Jerusalem": "IL", "Asia/Amman": "JO", "Asia/Beirut": "LB",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU", "Australia/Perth": "AU", "Australia/Adelaide": "AU",
  "Pacific/Auckland": "NZ",
};
const REGION_CURRENCY: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", UG: "UGX", TZ: "TZS", RW: "RWF", ZA: "ZAR", EG: "EGP", MA: "MAD", ET: "ETB",
  ZM: "ZMW", CM: "XAF", SN: "XOF", CI: "XOF", BJ: "XOF", TG: "XOF", BF: "XOF", ML: "XOF", NE: "XOF", GA: "XAF",
  LR: "LRD", SL: "SLE", GM: "GMD", MW: "MWK", ZW: "USD", BW: "BWP", NA: "NAD", MZ: "MZN", AO: "AOA", SD: "SDG",
  CD: "CDF", TN: "TND", DZ: "DZD", LY: "LYD", SO: "SOS", DJ: "DJF", ER: "ERN", SS: "SSP", BI: "BIF", LS: "LSL",
  SZ: "SZL", MU: "MUR", MG: "MGA", CV: "CVE",
  US: "USD", GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", BE: "EUR",
  AT: "EUR", FI: "EUR", GR: "EUR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF",
  RO: "RON", TR: "TRY", UA: "UAH", RU: "RUB",
  CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CO: "COP", PE: "PEN", CL: "CLP", JM: "JMD", TT: "TTD", BB: "BBD",
  AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", IN: "INR", PK: "PKR", BD: "BDT", NP: "NPR",
  LK: "LKR", PH: "PHP", SG: "SGD", MY: "MYR", ID: "IDR", TH: "THB", VN: "VND", JP: "JPY", KR: "KRW", CN: "CNY",
  HK: "HKD", IL: "ILS", JO: "JOD", LB: "LBP", AU: "AUD", NZ: "NZD",
};

export interface DetectedLocale {
  /** ISO country code, or null when the device does not say. */
  country: string | null;
  currency: string;
  timezone: string;
}

export const detectLocale = (): DetectedLocale => {
  let timezone = "Africa/Lagos";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    // keep the default
  }
  let country: string | null = ZONE_COUNTRY[timezone] || null;
  if (!country) {
    const region = (typeof navigator !== "undefined" ? navigator.language : "").split("-")[1]?.toUpperCase();
    country = region && REGION_CURRENCY[region] ? region : null;
  }
  return { country, currency: (country && REGION_CURRENCY[country]) || "NGN", timezone };
};

// Every country (ISO 3166), named in the reader's language, A–Z.
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GI GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL " +
  "NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TC TD TG TH TJ TL TM " +
  "TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WS XK YE ZA ZM ZW"
).split(" ");

let countryCache: { value: string; label: string }[] | null = null;
export const countryOptions = () => {
  if (countryCache) return countryCache;
  countryCache = COUNTRY_CODES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label));
  return countryCache;
};

/** The usual currency of a country, when Schoolivio knows it. */
export const currencyForCountry = (country: string | null | undefined) => (country ? REGION_CURRENCY[country] || null : null);
