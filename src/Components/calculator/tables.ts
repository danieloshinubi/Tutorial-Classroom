// SHIFT 7 (CONST) and SHIFT 8 (CONV): the 40 scientific constants and 40
// unit conversions built into the fx-991ES PLUS, in its own order and with
// its own (CODATA 2010) values, so an answer matches the pupil's own
// calculator digit for digit.

export type Constant = { sym: string; name: string; value: number };

export const CONSTANTS: Constant[] = [
  { sym: "mp", name: "Proton mass", value: 1.672621777e-27 },
  { sym: "mn", name: "Neutron mass", value: 1.674927351e-27 },
  { sym: "me", name: "Electron mass", value: 9.10938291e-31 },
  { sym: "mμ", name: "Muon mass", value: 1.883531475e-28 },
  { sym: "a₀", name: "Bohr radius", value: 5.2917721092e-11 },
  { sym: "h", name: "Planck constant", value: 6.62606957e-34 },
  { sym: "μN", name: "Nuclear magneton", value: 5.05078353e-27 },
  { sym: "μB", name: "Bohr magneton", value: 9.27400968e-24 },
  { sym: "ħ", name: "Reduced Planck constant", value: 1.054571726e-34 },
  { sym: "α", name: "Fine-structure constant", value: 7.2973525698e-3 },
  { sym: "re", name: "Classical electron radius", value: 2.8179403267e-15 },
  { sym: "λc", name: "Compton wavelength", value: 2.4263102389e-12 },
  { sym: "γp", name: "Proton gyromagnetic ratio", value: 2.675222005e8 },
  { sym: "λcp", name: "Proton Compton wavelength", value: 1.32140985623e-15 },
  { sym: "λcn", name: "Neutron Compton wavelength", value: 1.3195909068e-15 },
  { sym: "R∞", name: "Rydberg constant", value: 10973731.568539 },
  { sym: "u", name: "Atomic mass unit", value: 1.660538921e-27 },
  { sym: "μp", name: "Proton magnetic moment", value: 1.410606743e-26 },
  { sym: "μe", name: "Electron magnetic moment", value: -9.2847643e-24 },
  { sym: "μn", name: "Neutron magnetic moment", value: -9.6623647e-27 },
  { sym: "μμ", name: "Muon magnetic moment", value: -4.49044807e-26 },
  { sym: "F", name: "Faraday constant", value: 96485.3365 },
  { sym: "e", name: "Elementary charge", value: 1.602176565e-19 },
  { sym: "NA", name: "Avogadro constant", value: 6.02214129e23 },
  { sym: "k", name: "Boltzmann constant", value: 1.3806488e-23 },
  { sym: "Vm", name: "Molar volume of ideal gas", value: 22.710953e-3 },
  { sym: "R", name: "Molar gas constant", value: 8.3144621 },
  { sym: "C₀", name: "Speed of light in vacuum", value: 299792458 },
  { sym: "C₁", name: "First radiation constant", value: 3.74177153e-16 },
  { sym: "C₂", name: "Second radiation constant", value: 1.438777e-2 },
  { sym: "σ", name: "Stefan–Boltzmann constant", value: 5.670373e-8 },
  { sym: "ε₀", name: "Electric constant", value: 8.854187817e-12 },
  { sym: "μ₀", name: "Magnetic constant", value: 1.2566370614e-6 },
  { sym: "φ₀", name: "Magnetic flux quantum", value: 2.067833758e-15 },
  { sym: "g", name: "Standard gravity", value: 9.80665 },
  { sym: "G₀", name: "Conductance quantum", value: 7.7480917346e-5 },
  { sym: "Z₀", name: "Impedance of vacuum", value: 376.730313461 },
  { sym: "t", name: "Celsius temperature", value: 273.15 },
  { sym: "G", name: "Newtonian gravitation", value: 6.67384e-11 },
  { sym: "atm", name: "Standard atmosphere", value: 101325 },
];

export type Conversion = { sym: string; apply: (x: number) => number };

const pair = (a: string, b: string, factor: number): Conversion[] => [
  { sym: `${a}▸${b}`, apply: (x) => x * factor },
  { sym: `${b}▸${a}`, apply: (x) => x / factor },
];

export const CONVERSIONS: Conversion[] = [
  ...pair("in", "cm", 2.54),
  ...pair("ft", "m", 0.3048),
  ...pair("yd", "m", 0.9144),
  ...pair("mile", "km", 1.609344),
  ...pair("n mile", "m", 1852),
  ...pair("acre", "m²", 4046.856422),
  ...pair("gal(US)", "ℓ", 3.785411784),
  ...pair("gal(UK)", "ℓ", 4.54609),
  ...pair("pc", "km", 3.085677581e13),
  ...pair("km/h", "m/s", 1 / 3.6),
  ...pair("oz", "g", 28.349523125),
  ...pair("lb", "kg", 0.45359237),
  ...pair("atm", "Pa", 101325),
  ...pair("mmHg", "Pa", 133.322368),
  ...pair("hp", "kW", 0.73549875),
  ...pair("kgf/cm²", "Pa", 98066.5),
  ...pair("kgf•m", "J", 9.80665),
  ...pair("lbf/in²", "kPa", 6.894757293),
  { sym: "°F▸°C", apply: (x) => (x - 32) / 1.8 },
  { sym: "°C▸°F", apply: (x) => x * 1.8 + 32 },
  { sym: "J▸cal", apply: (x) => x / 4.184 },
  { sym: "cal▸J", apply: (x) => x * 4.184 },
];

export const constantBySym = new Map(CONSTANTS.map((c) => [`const:${c.sym}`, c]));
export const conversionBySym = new Map(CONVERSIONS.map((c) => [`conv:${c.sym}`, c]));
