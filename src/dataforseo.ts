const DFS_URL  = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
const DFS_USER = process.env.DATAFORSEO_USERNAME ?? "";
const DFS_PASS = process.env.DATAFORSEO_PASSWORD ?? "";

const AUTH = Buffer.from(`${DFS_USER}:${DFS_PASS}`).toString("base64");

export interface PointCheckResult {
  lat: number;
  lng: number;
  zone_label: string | null;
  organic_position: number | null;
  local_pack_position: number | null;
  in_top3: boolean;
  in_top10: boolean;
}

export async function checkPoint(
  keyword: string,
  lat: number,
  lng: number,
  targetDomain: string,
  zoneLabel: string | null = null,
): Promise<PointCheckResult> {
  const body = [{
    keyword,
    location_coordinate: `${lat},${lng}`,
    language_code: "fr",
    depth: 20,
    se_domain: "google.fr",
  }];

  try {
    const res = await fetch(DFS_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${AUTH}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return nullResult(lat, lng, zoneLabel);
    }

    const data = await res.json() as any;
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const organics   = items.filter((i: any) => i.type === "organic");
    const localPacks = items.filter((i: any) => i.type === "local_pack");

    const at2oOrg = organics.find((i: any) => (i.url ?? "").includes(targetDomain));
    const at2oLp  = localPacks.find((i: any) =>
      (i.url ?? "").includes(targetDomain) ||
      (i.domain ?? "").includes(targetDomain)
    );

    const orgPos = at2oOrg?.rank_absolute ?? null;
    const lpPos  = at2oLp?.rank_absolute  ?? null;

    return {
      lat, lng,
      zone_label: zoneLabel,
      organic_position: orgPos,
      local_pack_position: lpPos,
      in_top3:  orgPos !== null && orgPos <= 3,
      in_top10: orgPos !== null && orgPos <= 10,
    };
  } catch {
    return nullResult(lat, lng, zoneLabel);
  }
}

function nullResult(lat: number, lng: number, zone_label: string | null): PointCheckResult {
  return { lat, lng, zone_label, organic_position: null, local_pack_position: null, in_top3: false, in_top10: false };
}

export async function checkVolume(keywords: string[]): Promise<Record<string, number | null>> {
  const url = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
  const body = [{ keywords, language_code: "fr", location_code: 2250 }];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${AUTH}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) return Object.fromEntries(keywords.map(k => [k, null]));

    const data = await res.json() as any;
    const items: any[] = data?.tasks?.[0]?.result ?? [];
    const result: Record<string, number | null> = {};

    for (const kw of keywords) {
      const item = items.find((i: any) => i.keyword === kw);
      result[kw] = item?.search_volume ?? null;
    }

    return result;
  } catch {
    return Object.fromEntries(keywords.map(k => [k, null]));
  }
}

export const DELAY_MS = 400;
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Intent qualification ──────────────────────────────────────────────────────

export type BusinessType = "service" | "retail" | "food" | "professional";

// Domains with no physical stores — pure online players
const PURE_ONLINE_DOMAINS = [
  "amazon.fr", "amazon.com", "cdiscount.com", "manomano.fr", "aliexpress.com",
  "rueducommerce.fr", "materiel.net", "ldlc.com",
];

// Domains that also have physical stores — for retail, their presence signals local intent
const PHYSICAL_RETAIL_DOMAINS = [
  "fnac.com", "darty.com", "boulanger.com", "decathlon.fr", "leroymerlin.fr",
  "castorama.fr", "bricomarche.fr", "bricodepot.fr",
];

// All e-commerce (pure + physical) — red flag only for service businesses
const ECOMMERCE_DOMAINS = [...PURE_ONLINE_DOMAINS, ...PHYSICAL_RETAIL_DOMAINS];

const PRODUCT_BRANDS = [
  "somfy", "diagral", "ajax", "ring", "netatmo", "daewoo", "hikvision",
  "arlo", "delta dore", "tydom", "risco", "paradox", "bosch",
];

const SERVICE_SIGNALS = [
  "installateur", "installation", "pose", "artisan", "entreprise",
  "devis", "prestataire", "technicien", "professionnel",
];

const FOOD_AGGREGATORS = [
  "tripadvisor.fr", "thefork.fr", "lafourchette.fr", "yelp.fr",
  "michelin.fr", "restaurant.fr", "viamichelin.fr",
];

const FOOD_SIGNALS = [
  "restaurant", "café", "bar", "boulangerie", "bistrot", "traiteur",
  "pizzeria", "brasserie", "crêperie", "gastronomique",
];

const PROFESSIONAL_AGGREGATORS = [
  "doctolib.fr", "pages-jaunes.fr", "avocats.fr", "kelsante.fr",
  "annuaire-medecins.fr", "legalplace.fr", "compta-online.fr",
];

const PROFESSIONAL_SIGNALS = [
  "cabinet", "avocat", "médecin", "comptable", "architecte", "notaire",
  "expert", "consultant", "conseiller", "thérapeute",
];

export interface IntentResult {
  keyword: string;
  business_type: BusinessType;
  intent: "product" | "service" | "mixed";
  confidence: "high" | "medium" | "low";
  product_score: number;
  service_score: number;
  signals: {
    has_shopping: boolean;
    has_local_pack: boolean;
    ecommerce_domains: string[];
    service_domains: string[];
    prices_displayed: number;
    paa_about_installation: boolean;
  };
  top10_domains: string[];
  recommendation: string;
}

export async function qualifyIntent(keyword: string, businessType: BusinessType = "service"): Promise<IntentResult> {
  const body = [{
    keyword,
    location_code: 2250,
    language_code: "fr",
    depth: 10,
    se_domain: "google.fr",
  }];

  const nullIntent = (): IntentResult => ({
    keyword,
    business_type: businessType,
    intent: "mixed",
    confidence: "low",
    product_score: 0,
    service_score: 0,
    signals: { has_shopping: false, has_local_pack: false, ecommerce_domains: [], service_domains: [], prices_displayed: 0, paa_about_installation: false },
    top10_domains: [],
    recommendation: "Impossible d'analyser le SERP pour ce keyword.",
  });

  try {
    const res = await fetch(DFS_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${AUTH}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return nullIntent();

    const data  = await res.json() as any;
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const organics  = items.filter((i: any) => i.type === "organic");
    const shopping  = items.filter((i: any) => i.type === "shopping");
    const localPack = items.filter((i: any) => i.type === "local_pack");
    const paa       = items.filter((i: any) => i.type === "people_also_ask");

    const top10Domains = organics.slice(0, 10).map((i: any) => i.domain ?? "").filter(Boolean);
    const hasShopping  = shopping.length > 0;
    const hasLocalPack = localPack.length > 0;
    const pricesCount  = organics.filter((i: any) => i.price?.current != null).length;
    const kwLower      = keyword.toLowerCase();

    let productScore = 0;
    let serviceScore = 0;
    let intent: "product" | "service" | "mixed";
    let confidence: "high" | "medium" | "low";
    let recommendation: string;
    let ecommerceDomains: string[] = [];
    let serviceDomains: string[] = [];
    const paaInstall = paa.some((p: any) =>
      p.items?.some((el: any) =>
        SERVICE_SIGNALS.some(s => (el.title ?? "").toLowerCase().includes(s))
      )
    );

    if (businessType === "service") {
      // ── Prestataire itinérant ──────────────────────────────────────────────
      // product = achat DIY (e-commerce, prix, marques produit)
      // service = embaucher quelqu'un (local pack, mots installateur…)
      ecommerceDomains = top10Domains.filter((d: string) => ECOMMERCE_DOMAINS.some(e => d.includes(e)));
      serviceDomains   = top10Domains.filter((d: string) => !ECOMMERCE_DOMAINS.some(e => d.includes(e)));
      const hasBrandTitle = organics.some((i: any) => PRODUCT_BRANDS.some(b => (i.title ?? "").toLowerCase().includes(b)));
      const serviceInTitles = organics.filter((i: any) => SERVICE_SIGNALS.some(s => (i.title ?? "").toLowerCase().includes(s))).length;

      productScore += hasShopping ? 3 : 0;
      productScore += ecommerceDomains.length * 2;
      productScore += pricesCount;
      productScore += hasBrandTitle ? 1 : 0;

      serviceScore += hasLocalPack ? 3 : 0;
      serviceScore += paaInstall ? 2 : 0;
      serviceScore += serviceInTitles;
      if (SERVICE_SIGNALS.some(s => kwLower.includes(s))) serviceScore += 4;

      const total = productScore + serviceScore;
      if (total === 0) { intent = "mixed"; confidence = "low"; }
      else if (productScore / total >= 0.7) { intent = "product"; confidence = productScore >= 6 ? "high" : "medium"; }
      else if (serviceScore / total >= 0.7) { intent = "service"; confidence = serviceScore >= 5 ? "high" : "medium"; }
      else { intent = "mixed"; confidence = "medium"; }

      recommendation = intent === "product"
        ? "Ce keyword cible des acheteurs de produits DIY (Amazon, Leroy Merlin…). Peu pertinent pour un prestataire — réorienter vers des variantes avec 'installateur' ou 'pose'."
        : intent === "service"
        ? "Ce keyword cible des prospects cherchant un prestataire. Pertinent pour se positionner."
        : "Intention mixte — le SERP mélange produits et services. Se positionner est possible mais la page doit clairement se différencier des produits DIY.";

    } else if (businessType === "retail") {
      // ── Commerce physique ──────────────────────────────────────────────────
      // local = local pack présent + enseignes physiques → bon pour un magasin
      // online_only = aucun local pack, pur e-commerce → pas de trafic en magasin
      const pureOnlineDomains    = top10Domains.filter((d: string) => PURE_ONLINE_DOMAINS.some(e => d.includes(e)));
      const physicalRetailInSerp = top10Domains.filter((d: string) => PHYSICAL_RETAIL_DOMAINS.some(e => d.includes(e)));
      ecommerceDomains = pureOnlineDomains;
      serviceDomains   = top10Domains.filter((d: string) => !PURE_ONLINE_DOMAINS.some(e => d.includes(e)));

      // serviceScore = intent local (bon pour un magasin)
      serviceScore += hasLocalPack ? 5 : 0;
      serviceScore += physicalRetailInSerp.length >= 2 ? 2 : physicalRetailInSerp.length > 0 ? 1 : 0;

      // productScore = intent 100% online (mauvais pour un magasin physique)
      productScore += !hasLocalPack && hasShopping ? 4 : 0;
      productScore += pureOnlineDomains.length >= 4 ? 3 : pureOnlineDomains.length >= 2 ? 1 : 0;

      const total = productScore + serviceScore;
      if (total === 0) { intent = "mixed"; confidence = "low"; }
      else if (serviceScore / total >= 0.6) { intent = "service"; confidence = serviceScore >= 5 ? "high" : "medium"; }
      else if (productScore / total >= 0.6) { intent = "product"; confidence = productScore >= 5 ? "high" : "medium"; }
      else { intent = "mixed"; confidence = "medium"; }

      recommendation = intent === "service"
        ? "Keyword avec intention locale forte (local pack présent). Pertinent pour un commerce physique — les gens cherchent près de chez eux."
        : intent === "product"
        ? "SERP dominé par des pure players en ligne, pas de local pack. Peu de trafic en magasin à attendre sur ce keyword — chercher une variante avec une dimension locale ('à [ville]', 'proche de moi')."
        : "Intention mixte — concurrence en ligne et physique coexistent. Le local pack n'est pas systématique ; tester une variante géolocalisée.";

    } else if (businessType === "food") {
      // ── Restauration / food ────────────────────────────────────────────────
      // local = local pack + agrégateurs food → bon pour un restaurant
      // no_local = aucun signal local → keyword trop générique ou informatif
      const foodAggregatorsInSerp = top10Domains.filter((d: string) => FOOD_AGGREGATORS.some(a => d.includes(a)));
      const foodInTitles = organics.filter((i: any) => FOOD_SIGNALS.some(s => (i.title ?? "").toLowerCase().includes(s))).length;
      serviceDomains = top10Domains.filter((d: string) => !ECOMMERCE_DOMAINS.some(e => d.includes(e)));

      serviceScore += hasLocalPack ? 6 : 0;
      serviceScore += foodAggregatorsInSerp.length >= 2 ? 2 : foodAggregatorsInSerp.length > 0 ? 1 : 0;
      serviceScore += foodInTitles >= 2 ? 1 : 0;

      productScore += !hasLocalPack ? 5 : 0;

      const total = productScore + serviceScore;
      if (total === 0) { intent = "mixed"; confidence = "low"; }
      else if (serviceScore / total >= 0.55) { intent = "service"; confidence = serviceScore >= 6 ? "high" : "medium"; }
      else if (productScore / total >= 0.7) { intent = "product"; confidence = "medium"; }
      else { intent = "mixed"; confidence = "medium"; }

      recommendation = intent === "service"
        ? "Keyword avec fort signal local (local pack + agrégateurs food). Pertinent pour un restaurant ou commerce alimentaire."
        : intent === "product"
        ? "Aucun signal local dans ce SERP — mot-clé trop générique ou informatif. Ajouter une ville ou une spécialité pour déclencher le local pack."
        : "Signal local partiel — tester avec une variante plus géolocalisée (ex: 'restaurant japonais Strasbourg').";

    } else {
      // ── Professionnel libéral (avocat, médecin, comptable…) ───────────────
      // service = local pack + agrégateurs pro → gens cherchent un pro
      // product = SERP informatif → gens cherchent de l'info, pas un pro
      const proAggregatorsInSerp = top10Domains.filter((d: string) => PROFESSIONAL_AGGREGATORS.some(a => d.includes(a)));
      const proInTitles = organics.filter((i: any) => PROFESSIONAL_SIGNALS.some(s => (i.title ?? "").toLowerCase().includes(s))).length;
      serviceDomains = top10Domains.filter((d: string) => !ECOMMERCE_DOMAINS.some(e => d.includes(e)));

      serviceScore += hasLocalPack ? 4 : 0;
      serviceScore += proAggregatorsInSerp.length >= 2 ? 3 : proAggregatorsInSerp.length > 0 ? 1 : 0;
      serviceScore += proInTitles;
      if (PROFESSIONAL_SIGNALS.some(s => kwLower.includes(s))) serviceScore += 3;

      // Informational intent → people researching, not hiring
      const informationalDomains = ["wikipedia.org", "service-public.fr", "legifrance.gouv.fr", "ameli.fr"];
      const infoCount = top10Domains.filter((d: string) => informationalDomains.some(i => d.includes(i))).length;
      productScore += infoCount * 2;
      productScore += !hasLocalPack && proAggregatorsInSerp.length === 0 ? 3 : 0;

      const total = productScore + serviceScore;
      if (total === 0) { intent = "mixed"; confidence = "low"; }
      else if (serviceScore / total >= 0.65) { intent = "service"; confidence = serviceScore >= 5 ? "high" : "medium"; }
      else if (productScore / total >= 0.65) { intent = "product"; confidence = productScore >= 5 ? "high" : "medium"; }
      else { intent = "mixed"; confidence = "medium"; }

      recommendation = intent === "service"
        ? "Keyword transactionnel — les gens cherchent un professionnel à contacter. Pertinent pour se positionner."
        : intent === "product"
        ? "Ce SERP est informatif — les gens cherchent de l'info, pas un professionnel. Orienter vers une variante transactionnelle (ex: 'cabinet avocat Lyon', 'médecin généraliste Paris')."
        : "Intention mixte — certains cherchent de l'info, d'autres un professionnel. La page doit clairement positionner l'expertise et proposer une prise de contact.";
    }

    return {
      keyword,
      business_type: businessType,
      intent,
      confidence,
      product_score: productScore,
      service_score: serviceScore,
      signals: {
        has_shopping: hasShopping,
        has_local_pack: hasLocalPack,
        ecommerce_domains: ecommerceDomains,
        service_domains: serviceDomains.slice(0, 5),
        prices_displayed: pricesCount,
        paa_about_installation: paaInstall,
      },
      top10_domains: top10Domains,
      recommendation,
    };
  } catch {
    return nullIntent();
  }
}
