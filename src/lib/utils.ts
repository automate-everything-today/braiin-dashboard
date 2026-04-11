import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Sanitise text - replace em dashes and en dashes with standard hyphens.
 * Must be applied to ALL AI-generated text before display.
 */
export function sanitiseText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\u2013/g, "-")  // en dash
    .replace(/\u2014/g, "-")  // em dash
    .replace(/\u2015/g, "-")  // horizontal bar
    .replace(/\u2212/g, "-")  // minus sign
    .replace(/\u2010/g, "-")  // hyphen
    .replace(/\u2011/g, "-"); // non-breaking hyphen
}

export const formatGBP = (v: number): string =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

export const formatPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export const MONTH_LABELS: Record<string, string> = {
  "2025-01":"Jan 25","2025-02":"Feb 25","2025-03":"Mar 25","2025-04":"Apr 25",
  "2025-05":"May 25","2025-06":"Jun 25","2025-07":"Jul 25","2025-08":"Aug 25",
  "2025-09":"Sep 25","2025-10":"Oct 25","2025-11":"Nov 25","2025-12":"Dec 25",
  "2026-01":"Jan 26","2026-02":"Feb 26","2026-03":"Mar 26","2026-04":"Apr 26",
  "2026-05":"May 26","2026-06":"Jun 26","2026-07":"Jul 26","2026-08":"Aug 26",
  "2026-09":"Sep 26","2026-10":"Oct 26","2026-11":"Nov 26","2026-12":"Dec 26",
};

const COUNTRY_FLAGS: Record<string, string> = {
  "UK": "GB", "China": "CN", "USA": "US", "Germany": "DE", "France": "FR",
  "Italy": "IT", "Spain": "ES", "Netherlands": "NL", "Belgium": "BE",
  "Japan": "JP", "South Korea": "KR", "India": "IN", "Vietnam": "VN",
  "Thailand": "TH", "Malaysia": "MY", "Singapore": "SG", "Taiwan": "TW",
  "Hong Kong": "HK", "Brazil": "BR", "Colombia": "CO", "Mexico": "MX",
  "Australia": "AU", "UAE": "AE", "Turkey": "TR", "Pakistan": "PK",
  "Bangladesh": "BD", "Sri Lanka": "LK", "South Africa": "ZA",
  "Poland": "PL", "Czech Republic": "CZ", "Sweden": "SE", "Denmark": "DK",
  "Norway": "NO", "Ireland": "IE", "Portugal": "PT", "Greece": "GR",
  "Egypt": "EG", "Kenya": "KE", "Nigeria": "NG", "Philippines": "PH",
};

export function countryFlag(country: string): string {
  const code = COUNTRY_FLAGS[country];
  if (!code) return "";
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

export function calculateHqFee(jobGP: number, opsFee: number = 150): number {
  if (jobGP <= 0) return 0;
  if (jobGP <= 150) return jobGP * 0.5;
  if (jobGP <= 1000) return opsFee;
  if (jobGP <= 3000) return jobGP * 0.15;
  if (jobGP <= 5000) return jobGP * 0.175;
  return jobGP * 0.20;
}

export function calculateStaffBonus(monthlySalary: number, multiplier: number): number {
  return monthlySalary * multiplier;
}

export function calculateEbitBonus(totalEbit: number, threshold: number = 300000): { bonusPool: number; perPerson: number } {
  const above = Math.max(0, totalEbit - threshold);
  const bonusPool = above * 0.5;
  return { bonusPool, perPerson: bonusPool / 2 };
}

export function calculateEquityDividend(totalEbit: number, pct: number = 0.075): number {
  return Math.max(0, totalEbit) * pct;
}

export function getClientTier(avgMonthly: number): "Platinum" | "Gold" | "Silver" | "Bronze" | "Starter" {
  if (avgMonthly >= 10000) return "Platinum";
  if (avgMonthly >= 5000) return "Gold";
  if (avgMonthly >= 2000) return "Silver";
  if (avgMonthly >= 500) return "Bronze";
  return "Starter";
}
