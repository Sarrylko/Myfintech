// Maps normalized institution names to domains used with Clearbit Logo API.
// Only well-known institutions are listed. Unknown names get no logo.
const INSTITUTION_DOMAIN_MAP: Record<string, string> = {
  // Brokerages
  "etrade": "etrade.com",
  "e*trade": "etrade.com",
  "e-trade": "etrade.com",
  "fidelity": "fidelity.com",
  "fidelity investments": "fidelity.com",
  "fidelity netbenefits": "fidelity.com",
  "robinhood": "robinhood.com",
  "charles schwab": "schwab.com",
  "schwab": "schwab.com",
  "vanguard": "vanguard.com",
  "td ameritrade": "tdameritrade.com",
  "merrill lynch": "merrilledge.com",
  "merrill edge": "merrilledge.com",
  "interactive brokers": "interactivebrokers.com",
  "ibkr": "interactivebrokers.com",
  "webull": "webull.com",
  "tastyworks": "tastytrade.com",
  "tastytrade": "tastytrade.com",
  "public": "public.com",
  "firstrade": "firstrade.com",
  "m1 finance": "m1.com",
  "m1": "m1.com",
  "wealthfront": "wealthfront.com",
  "betterment": "betterment.com",
  "acorns": "acorns.com",
  "stash": "stash.com",
  "coinbase": "coinbase.com",
  "sofi": "sofi.com",
  "sofi invest": "sofi.com",
  "sofi bank": "sofi.com",

  // Banks
  "chase": "chase.com",
  "jpmorgan": "chase.com",
  "jp morgan": "chase.com",
  "jpmorgan chase": "chase.com",
  "bank of america": "bankofamerica.com",
  "wells fargo": "wellsfargo.com",
  "citibank": "citi.com",
  "citi": "citi.com",
  "ally": "ally.com",
  "ally bank": "ally.com",
  "ally invest": "ally.com",
  "capital one": "capitalone.com",
  "american express": "americanexpress.com",
  "amex": "americanexpress.com",
  "discover": "discover.com",
  "discover bank": "discover.com",
  "usaa": "usaa.com",
  "navy federal": "navyfederal.org",
  "navy federal credit union": "navyfederal.org",
  "pnc": "pnc.com",
  "pnc bank": "pnc.com",
  "us bank": "usbank.com",
  "u.s. bank": "usbank.com",
  "regions": "regions.com",
  "regions bank": "regions.com",
  "truist": "truist.com",
  "suntrust": "truist.com",
  "bb&t": "truist.com",
  "citizens": "citizensbank.com",
  "citizens bank": "citizensbank.com",
  "td bank": "td.com",
  "fifth third": "53.com",
  "fifth third bank": "53.com",
  "huntington": "huntington.com",
  "huntington bank": "huntington.com",
  "keybank": "key.com",
  "key bank": "key.com",
  "m&t bank": "mtb.com",
  "synovus": "synovus.com",
  "silicon valley bank": "svb.com",

  // Wirehouses / Wealth Mgmt
  "morgan stanley": "morganstanley.com",
  "goldman sachs": "goldmansachs.com",
  "raymond james": "raymondjames.com",
  "edward jones": "edwardjones.com",
  "ameriprise": "ameriprise.com",
  "ubs": "ubs.com",
  "lpl financial": "lpl.com",

  // Retirement / Insurance
  "principal": "principal.com",
  "empower": "empower.com",
  "empower retirement": "empower.com",
  "nationwide": "nationwide.com",
  "transamerica": "transamerica.com",
  "john hancock": "johnhancock.com",
  "tiaa": "tiaa.org",
  "voya": "voya.com",
  "lincoln financial": "lfg.com",
  "prudential": "prudential.com",
  "metlife": "metlife.com",
  "blackrock": "blackrock.com",
};

export function getInstitutionDomain(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  return INSTITUTION_DOMAIN_MAP[normalized] ?? null;
}

export function getInstitutionLogoUrl(name: string | null | undefined, size = 32): string | null {
  const domain = getInstitutionDomain(name);
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}?size=${size}`;
}

export function getInstitutionFaviconUrl(name: string | null | undefined): string | null {
  const domain = getInstitutionDomain(name);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
