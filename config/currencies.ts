// Currencies offered in the scope editor (ISO 4217) and the locale used to format each one.
// Edit this list to change what the editor offers; order is display order. Never remove a code that
// saved scopes use: signed content must keep validating. USD, INR, GBP and EUR were the original four.
// WS-01 (M4): `exponent` is the ISO 4217 minor-unit exponent (decimal places) used for every money
// computation and for display (lib/minor.ts, lib/currency.ts formatMoney). ISO, not CLDR: Intl
// shows IDR and PKR with 0 digits, ISO 4217 gives them 2.
export type CurrencyConfig = {code: string; locale: string; name: string; exponent: number};
export const currencies: CurrencyConfig[] = [
  {code: 'USD', locale: 'en-US', name: 'US dollar', exponent: 2},
  {code: 'INR', locale: 'en-IN', name: 'Indian rupee', exponent: 2},
  {code: 'EUR', locale: 'en-IE', name: 'Euro', exponent: 2},
  {code: 'GBP', locale: 'en-GB', name: 'Pound sterling', exponent: 2},
  {code: 'AUD', locale: 'en-AU', name: 'Australian dollar', exponent: 2},
  {code: 'CAD', locale: 'en-CA', name: 'Canadian dollar', exponent: 2},
  {code: 'SGD', locale: 'en-SG', name: 'Singapore dollar', exponent: 2},
  {code: 'AED', locale: 'en-AE', name: 'UAE dirham', exponent: 2},
  {code: 'SAR', locale: 'en-SA', name: 'Saudi riyal', exponent: 2},
  {code: 'NZD', locale: 'en-NZ', name: 'New Zealand dollar', exponent: 2},
  {code: 'CHF', locale: 'de-CH', name: 'Swiss franc', exponent: 2},
  {code: 'JPY', locale: 'en-US', name: 'Japanese yen', exponent: 0},
  {code: 'HKD', locale: 'en-HK', name: 'Hong Kong dollar', exponent: 2},
  {code: 'ZAR', locale: 'en-ZA', name: 'South African rand', exponent: 2},
  {code: 'MYR', locale: 'en-MY', name: 'Malaysian ringgit', exponent: 2},
  {code: 'PHP', locale: 'en-PH', name: 'Philippine peso', exponent: 2},
  {code: 'IDR', locale: 'id-ID', name: 'Indonesian rupiah', exponent: 2},
  {code: 'LKR', locale: 'en-LK', name: 'Sri Lankan rupee', exponent: 2},
  {code: 'BDT', locale: 'en-BD', name: 'Bangladeshi taka', exponent: 2},
  {code: 'NPR', locale: 'en-NP', name: 'Nepalese rupee', exponent: 2},
  {code: 'PKR', locale: 'en-PK', name: 'Pakistani rupee', exponent: 2},
  {code: 'KES', locale: 'en-KE', name: 'Kenyan shilling', exponent: 2},
  {code: 'NGN', locale: 'en-NG', name: 'Nigerian naira', exponent: 2},
  {code: 'BRL', locale: 'pt-BR', name: 'Brazilian real', exponent: 2},
  {code: 'MXN', locale: 'es-MX', name: 'Mexican peso', exponent: 2},
  {code: 'SEK', locale: 'sv-SE', name: 'Swedish krona', exponent: 2},
  {code: 'NOK', locale: 'nb-NO', name: 'Norwegian krone', exponent: 2},
  {code: 'DKK', locale: 'da-DK', name: 'Danish krone', exponent: 2},
  {code: 'PLN', locale: 'pl-PL', name: 'Polish zloty', exponent: 2},
];

// ISO 4217 exponents for codes that are not offered in the editor but may reach the money helpers
// (e.g. a payment or a rate in another currency). Offered codes take their exponent from the list
// above. Anything unknown falls back to 2 decimals (lib/minor.ts exponentOf).
export const otherExponents: Record<string, number> = {
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
  KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, XAF: 0, XOF: 0, XPF: 0, PYG: 0, RWF: 0, KMF: 0, GNF: 0, DJF: 0, VUV: 0,
};
