const USER_AGENT = "Mozilla/5.0 (compatible; Braiin/1.0)";
const HOMEPAGE_LIMIT = 3000;
const SUBPAGE_LIMIT = 2000;
const SUBPAGES = ["/about", "/about-us", "/services", "/our-services"];

function stripHtml(html: string, limit: number): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, limit);
}

function isValidExternalDomain(domain: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) return false;
  if (domain === "localhost" || domain.endsWith(".local") || domain.endsWith(".internal")) return false;
  if (!domain.includes(".")) return false;
  return true;
}

export async function scrapeWebsite(domain: string): Promise<string> {
  if (!domain || !isValidExternalDomain(domain)) {
    console.warn(`[enrichment] Blocked scrape for invalid domain: ${domain}`);
    return "";
  }

  let websiteText = "";

  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      websiteText = stripHtml(await res.text(), HOMEPAGE_LIMIT);
    }
  } catch (err) {
    console.error(`[enrichment] Failed to scrape homepage for ${domain}:`, err);
  }

  for (const path of SUBPAGES) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const pageText = stripHtml(await res.text(), SUBPAGE_LIMIT);
        websiteText += `\n\n--- ${path} ---\n${pageText}`;
      }
    } catch {
      // Subpage not found or timeout - expected
    }
  }

  return websiteText;
}
