// Maps normalized merchant names to their website domains for logo lookup.
// Clearbit Logo API is used: https://logo.clearbit.com/{domain}
// Unknown merchants fall back to a first-word heuristic (e.g. "Amazon" → amazon.com).
const MERCHANT_DOMAIN_MAP: Record<string, string> = {
  // Retail / Shopping
  "amazon": "amazon.com",
  "amazon.com": "amazon.com",
  "amazon prime": "amazon.com",
  "amazon marketplace": "amazon.com",
  "walmart": "walmart.com",
  "walmart supercenter": "walmart.com",
  "target": "target.com",
  "costco": "costco.com",
  "sam's club": "samsclub.com",
  "best buy": "bestbuy.com",
  "home depot": "homedepot.com",
  "the home depot": "homedepot.com",
  "lowe's": "lowes.com",
  "lowes": "lowes.com",
  "ikea": "ikea.com",
  "nordstrom": "nordstrom.com",
  "nordstrom rack": "nordstromrack.com",
  "macy's": "macys.com",
  "macys": "macys.com",
  "tj maxx": "tjmaxx.com",
  "marshalls": "marshalls.com",
  "ross": "rossstores.com",
  "gap": "gap.com",
  "old navy": "oldnavy.com",
  "h&m": "hm.com",
  "zara": "zara.com",
  "nike": "nike.com",
  "adidas": "adidas.com",
  "ebay": "ebay.com",
  "etsy": "etsy.com",
  "wayfair": "wayfair.com",
  "chewy": "chewy.com",

  // Groceries / Supermarkets
  "whole foods": "wholefoodsmarket.com",
  "whole foods market": "wholefoodsmarket.com",
  "trader joe's": "traderjoes.com",
  "trader joes": "traderjoes.com",
  "kroger": "kroger.com",
  "publix": "publix.com",
  "safeway": "safeway.com",
  "aldi": "aldi.us",
  "sprouts": "sprouts.com",
  "meijer": "meijer.com",
  "jewel-osco": "jewelosco.com",
  "jewel osco": "jewelosco.com",
  "jewel": "jewelosco.com",
  "thorntons": "mythorntons.com",
  "wegmans": "wegmans.com",
  "food lion": "foodlion.com",
  "giant": "giant.com",
  "harris teeter": "harristeeter.com",
  "heb": "heb.com",
  "winn-dixie": "winndixie.com",

  // Food & Drink / Restaurants
  "starbucks": "starbucks.com",
  "mcdonald's": "mcdonalds.com",
  "mcdonalds": "mcdonalds.com",
  "chick-fil-a": "chick-fil-a.com",
  "chipotle": "chipotle.com",
  "subway": "subway.com",
  "panera": "panerabread.com",
  "panera bread": "panerabread.com",
  "dunkin": "dunkindonuts.com",
  "dunkin'": "dunkindonuts.com",
  "taco bell": "tacobell.com",
  "burger king": "bk.com",
  "wendy's": "wendys.com",
  "wendys": "wendys.com",
  "pizza hut": "pizzahut.com",
  "domino's": "dominos.com",
  "dominos": "dominos.com",
  "olive garden": "olivegarden.com",
  "applebee's": "applebees.com",
  "ihop": "ihop.com",
  "cheesecake factory": "thecheesecakefactory.com",
  "potbelly": "potbelly.com",
  "potbelly sandwich shop": "potbelly.com",
  "five guys": "fiveguys.com",
  "shake shack": "shakeshack.com",
  "raising cane's": "raisingcanes.com",
  "wingstop": "wingstop.com",
  "panda express": "pandaexpress.com",
  "sonic": "sonicdrivein.com",
  "dairy queen": "dairyqueen.com",
  "culver's": "culvers.com",
  "in-n-out": "in-n-out.com",
  "whataburger": "whataburger.com",
  "cracker barrel": "crackerbarrel.com",
  "texas roadhouse": "texasroadhouse.com",
  "buffalo wild wings": "buffalowildwings.com",

  // Tech / Streaming / Subscriptions
  "apple": "apple.com",
  "apple.com": "apple.com",
  "apple.com/bill": "apple.com",
  "apple icloud": "apple.com",
  "google": "google.com",
  "google play": "google.com",
  "google storage": "google.com",
  "youtube": "youtube.com",
  "youtube premium": "youtube.com",
  "microsoft": "microsoft.com",
  "netflix": "netflix.com",
  "spotify": "spotify.com",
  "hulu": "hulu.com",
  "disney": "disneyplus.com",
  "disney+": "disneyplus.com",
  "disney plus": "disneyplus.com",
  "hbo": "hbo.com",
  "max": "max.com",
  "paramount": "paramountplus.com",
  "paramount+": "paramountplus.com",
  "peacock": "peacocktv.com",
  "amazon prime video": "amazon.com",
  "linkedin": "linkedin.com",
  "linkedin premium": "linkedin.com",
  "zoom": "zoom.us",
  "slack": "slack.com",
  "dropbox": "dropbox.com",
  "adobe": "adobe.com",
  "canva": "canva.com",
  "notion": "notion.so",
  "chatgpt": "openai.com",
  "openai": "openai.com",
  "github": "github.com",
  "cloudflare": "cloudflare.com",

  // Transportation
  "uber": "uber.com",
  "lyft": "lyft.com",
  "tesla": "tesla.com",
  "tesla reservation": "tesla.com",
  "delta": "delta.com",
  "delta airlines": "delta.com",
  "united": "united.com",
  "united airlines": "united.com",
  "american airlines": "aa.com",
  "southwest": "southwest.com",
  "jetblue": "jetblue.com",
  "spirit airlines": "spirit.com",
  "frontier": "flyfrontier.com",
  "amtrak": "amtrak.com",

  // Gas Stations
  "shell": "shell.com",
  "bp": "bp.com",
  "exxon": "exxon.com",
  "exxonmobil": "exxon.com",
  "chevron": "chevron.com",
  "mobil": "exxon.com",
  "speedway": "speedway.com",
  "marathon": "marathonbrand.com",
  "sunoco": "sunoco.com",
  "circle k": "circlek.com",
  "7-eleven": "7-eleven.com",
  "wawa": "wawa.com",
  "casey's": "caseys.com",
  "kwik trip": "kwiktrip.com",

  // Health / Pharmacy
  "cvs": "cvs.com",
  "walgreens": "walgreens.com",
  "rite aid": "riteaid.com",
  "optum": "optum.com",
  "express scripts": "express-scripts.com",

  // Travel / Hotels
  "marriott": "marriott.com",
  "hilton": "hilton.com",
  "hyatt": "hyatt.com",
  "ihg": "ihg.com",
  "holiday inn": "ihg.com",
  "airbnb": "airbnb.com",
  "vrbo": "vrbo.com",
  "expedia": "expedia.com",
  "booking.com": "booking.com",
  "kayak": "kayak.com",
  "hotels.com": "hotels.com",

  // Telecom
  "at&t": "att.com",
  "att": "att.com",
  "verizon": "verizon.com",
  "t-mobile": "t-mobile.com",
  "tmobile": "t-mobile.com",
  "comcast": "comcast.com",
  "xfinity": "xfinity.com",
  "spectrum": "spectrum.com",
  "cox": "cox.com",

  // Insurance
  "allstate": "allstate.com",
  "state farm": "statefarm.com",
  "geico": "geico.com",
  "progressive": "progressive.com",
  "liberty mutual": "libertymutual.com",
  "farmers": "farmers.com",
  "nationwide": "nationwide.com",
  "travelers": "travelers.com",
  "aaa": "aaa.com",

  // Food Delivery
  "doordash": "doordash.com",
  "grubhub": "grubhub.com",
  "uber eats": "ubereats.com",
  "instacart": "instacart.com",
  "shipt": "shipt.com",
  "gopuff": "gopuff.com",

  // Payments / Finance
  "paypal": "paypal.com",
  "venmo": "venmo.com",
  "zelle": "zellepay.com",
  "cash app": "cash.app",
  "square": "squareup.com",
  "stripe": "stripe.com",
};

/**
 * Given a raw transaction merchant name or description, return a domain for logo lookup.
 * Strategy:
 *   1. Check the curated map
 *   2. Try first word + ".com" as a heuristic for single-brand names
 */
export function getMerchantDomain(merchantName: string | null | undefined, txnName?: string | null): string | null {
  const raw = merchantName || txnName;
  if (!raw) return null;

  const normalized = raw.toLowerCase().trim().replace(/[#*]/g, "").trim();

  // Exact match first
  if (MERCHANT_DOMAIN_MAP[normalized]) return MERCHANT_DOMAIN_MAP[normalized];

  // Try trimming trailing location/store info (e.g. "THORNTONS #0318 WEST CHICAGO US")
  // by checking if the first 1-2 words match something in the map
  const words = normalized.split(/\s+/);
  if (words.length > 1) {
    const twoWords = words.slice(0, 2).join(" ");
    if (MERCHANT_DOMAIN_MAP[twoWords]) return MERCHANT_DOMAIN_MAP[twoWords];
    const oneWord = words[0];
    if (MERCHANT_DOMAIN_MAP[oneWord]) return MERCHANT_DOMAIN_MAP[oneWord];
  }

  // Heuristic: if the merchant_name is a single clean word (provided by Plaid), try word.com
  // Only do this for merchant_name (not raw txn names which are messy)
  if (merchantName && words.length <= 2) {
    const slug = words[0].replace(/[^a-z0-9]/g, "");
    if (slug.length >= 3) return `${slug}.com`;
  }

  return null;
}

export function getMerchantLogoUrl(merchantName: string | null | undefined, txnName?: string | null, size = 32): string | null {
  const domain = getMerchantDomain(merchantName, txnName);
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}?size=${size}`;
}

export function getMerchantFaviconUrl(merchantName: string | null | undefined, txnName?: string | null): string | null {
  const domain = getMerchantDomain(merchantName, txnName);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
