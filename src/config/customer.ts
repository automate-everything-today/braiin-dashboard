interface CustomerConfig {
  readonly name: string;
  readonly emailDomain: string;
  readonly industry: string;
  readonly industryDescription: string;
  readonly pipedriveSubdomain: string;
}

export const CUSTOMER: CustomerConfig = {
  name: process.env.NEXT_PUBLIC_CUSTOMER_NAME || "Demo Company",
  emailDomain: process.env.NEXT_PUBLIC_CUSTOMER_EMAIL_DOMAIN || "example.com",
  industry: process.env.NEXT_PUBLIC_CUSTOMER_INDUSTRY || "Logistics",
  industryDescription:
    process.env.NEXT_PUBLIC_CUSTOMER_INDUSTRY_DESCRIPTION ||
    "a logistics / freight forwarding company",
  pipedriveSubdomain: process.env.NEXT_PUBLIC_PIPEDRIVE_SUBDOMAIN || "",
};

export const ADMIN_EMAILS: readonly string[] = (
  process.env.ADMIN_EMAILS ||
  process.env.ALLOWED_EMAILS ||
  ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0 && process.env.NODE_ENV !== "test") {
  console.warn(
    "[config] ADMIN_EMAILS is empty — all sign-in attempts will be rejected. Set ADMIN_EMAILS in your environment."
  );
}

export const DEFAULT_SENDER_EMAIL =
  process.env.DEFAULT_SENDER_EMAIL || `noreply@${CUSTOMER.emailDomain}`;

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${CUSTOMER.emailDomain.toLowerCase()}`);
}
