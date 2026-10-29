// Pure logic for Mission Kitchen. No DOM, no network, no clock reads: callers pass time in.
// Tolerates both data shapes in flight: menu slots as string or array, minutes or total_minutes,
// first_week.market_tip as store index (number or numeric string), store id, or plain text.

export const ALTITUDE_THRESHOLD_M = 1981; // CDC: above 6,500 ft boil 3 minutes
export const SHORT_PRICE_AGE = { AR: 3, BO: 3, NG: 3, GH: 3, SL: 3, ZW: 3, ET: 3 };
export const DEFAULT_PRICE_AGE = 12;
export const MEALS = ['breakfast', 'main', 'light'];

export const KITCHEN_PRESETS = {
  minimal: { fridge: 'no', burners: 1, rice_cooker: false, pressure_cooker: false, oven: false, blender: false },
  typical: { fridge: 'no', burners: 2, rice_cooker: false, pressure_cooker: false, oven: false, blender: false },
  full: { fridge: 'yes', burners: 2, rice_cooker: true, pressure_cooker: true, oven: true, blender: true },
};
export const DEFAULT_KITCHEN = KITCHEN_PRESETS.typical;

/** Text object {en: ...} or plain string to a display string. */
export function t(v, lang = 'en') {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] ?? v.en ?? '';
}

export function asList(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

export function totalMinutes(r) {
  return r.total_minutes ?? r.minutes ?? null;
}
export function activeMinutes(r) {
  return r.active_minutes ?? r.total_minutes ?? r.minutes ?? null;
}
export function isQuick(r) {
  const a = activeMinutes(r);
  return a != null && a <= 15;
}

/** Does an item scoped by `regions` apply to this region of this country? Missing scope = whole cluster. */
export function inRegion(item, regionId, countryCode) {
  const rs = item.regions;
  if (!rs || rs.length === 0) return true;
  if (rs.includes('*')) return true;
  if (regionId && rs.includes(regionId)) return true;
  if (countryCode && rs.includes(countryCode.toLowerCase())) return true;
  return false;
}

/** Can this kitchen make a recipe needing `needs`? "unreliable" fridge counts as no fridge. Unknown needs fail. */
export function kitchenFits(needs, kitchen = DEFAULT_KITCHEN) {
  for (const n of asList(needs)) {
    switch (n) {
      case 'burner': break;
      case 'two_burners': if (!(kitchen.burners >= 2)) return false; break;
      case 'fridge': if (kitchen.fridge !== 'yes') return false; break;
      case 'rice_cooker': case 'pressure_cooker': case 'oven': case 'blender':
        if (!kitchen[n]) return false; break;
      default: return false;
    }
  }
  return true;
}

export function recipeFits(r, regionId, countryCode, kitchen) {
  return inRegion(r, regionId, countryCode) && kitchenFits(r.needs, kitchen);
}

/** First recipe in an ordered slot (string or array of ids) that fits region and kitchen, else null. */
export function pickRecipe(slot, recipesById, regionId, kitchen = DEFAULT_KITCHEN, countryCode) {
  for (const id of asList(slot)) {
    const r = recipesById.get ? recipesById.get(id) : recipesById[id];
    if (r && recipeFits(r, regionId, countryCode, kitchen)) return r;
  }
  return null;
}

/** 7-day plan: [{day, breakfast, main, light}] with recipe objects or null for "no match". */
export function planWeek(cluster, regionId, kitchen = DEFAULT_KITCHEN, countryCode) {
  const byId = new Map((cluster.recipes || []).map((r) => [r.id, r]));
  return (cluster.menu || []).map((d) => {
    const out = { day: d.day };
    for (const m of MEALS) out[m] = pickRecipe(d[m], byId, regionId, kitchen, countryCode);
    return out;
  });
}

/** Regions for a country in a cluster. A country with no regions gets one whole-country entry. */
export function regionsFor(cluster, countryCode) {
  const c = (cluster.countries || []).find((x) => x.code === countryCode);
  if (!c) return [];
  if (!c.regions || c.regions.length === 0) return [{ id: countryCode.toLowerCase(), name: c.name }];
  return c.regions;
}

export function findRegion(cluster, countryCode, regionId) {
  return regionsFor(cluster, countryCode).find((r) => r.id === regionId) || null;
}

export function isHighAltitude(region) {
  if (!region) return false;
  if (typeof region.elevation_m === 'number') return region.elevation_m >= ALTITUDE_THRESHOLD_M;
  return region.altitude_high === true;
}

export function priceMaxAge(country) {
  if (country && typeof country.price_max_age_months === 'number') {
    // Conservative: a data value may only shorten the default for that country.
    const floor = SHORT_PRICE_AGE[country.code] ?? DEFAULT_PRICE_AGE;
    return Math.min(country.price_max_age_months, floor);
  }
  return SHORT_PRICE_AGE[country?.code] ?? DEFAULT_PRICE_AGE;
}

/**
 * Is a price observed in month "YYYY-MM" still fresh?
 * now = max(device clock, buildDate), so a phone with a wrong, old clock cannot revive stale prices.
 */
export function isPriceVisible(observed, nowMs, buildDate, maxAgeMonths = DEFAULT_PRICE_AGE) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(observed || ''));
  if (!m) return false;
  const built = buildDate ? Date.parse(buildDate) : NaN;
  const now = new Date(Math.max(Number.isFinite(nowMs) ? nowMs : 0, Number.isFinite(built) ? built : 0));
  if (now.getTime() === 0) return false;
  const age = (now.getUTCFullYear() * 12 + now.getUTCMonth()) - (Number(m[1]) * 12 + Number(m[2]) - 1);
  return age >= 0 && age <= maxAgeMonths;
}

/** The price to show for a staple to this user, or null. Needs explicit country (or single-country cluster) and region scope. */
export function visiblePrice(staple, cluster, countryCode, regionId, nowMs, buildDate) {
  const p = staple.price;
  if (!p || p.low == null || !p.currency || !p.unit || !p.observed) return null;
  const countries = cluster.countries || [];
  const pc = p.country || (countries.length === 1 ? countries[0].code : null);
  if (pc !== countryCode) return null;
  if (!p.regions || p.regions.length === 0) return null; // no scope, show less
  if (!inRegion(p, regionId, countryCode)) return null;
  const country = countries.find((c) => c.code === countryCode);
  if (!isPriceVisible(p.observed, nowMs, buildDate, priceMaxAge(country))) return null;
  return p;
}

export function storesFor(cluster, regionId, countryCode) {
  return (cluster.stores || []).filter((s) => inRegion(s, regionId, countryCode));
}

function firstWeekFor(cluster, regionId, countryCode) {
  const fw = cluster.first_week;
  if (Array.isArray(fw)) return fw.find((x) => inRegion(x, regionId, countryCode)) || null;
  return fw || null;
}

/** Resolve first_week.market_tip to {store, text}. */
export function marketTip(cluster, regionId, countryCode) {
  const fw = firstWeekFor(cluster, regionId, countryCode);
  const v = fw?.market_tip;
  if (v == null || v === '') return null;
  const stores = cluster.stores || [];
  let store = null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) store = stores[Number(v)] || null;
  else store = stores.find((s) => s.id === v) || null;
  if (store) {
    if (!inRegion(store, regionId, countryCode)) store = storesFor(cluster, regionId, countryCode)[0] || null;
    return store ? { store, text: t(store.tip) } : null;
  }
  return typeof v === 'string' ? { store: null, text: v } : null;
}

/** First-week safety tip. High-altitude regions get the 3-minute boil item when the data has one. */
export function safetyTip(cluster, regionId, countryCode, region) {
  const safety = (cluster.safety || []).filter((s) => inRegion(s, regionId, countryCode));
  if (isHighAltitude(region)) {
    const boil3 = safety.find((s) => /3 minutes/i.test(t(s.body)));
    if (boil3) return boil3;
  }
  const fw = firstWeekFor(cluster, regionId, countryCode);
  const ids = asList(fw?.safety_tip);
  for (const id of ids) {
    const s = safety.find((x) => x.id === id);
    if (s) return s;
  }
  return safety[0] || null;
}

/** Safety list for Stay well: urgent items first, original order otherwise. */
export function safetyFor(cluster, regionId, countryCode) {
  const list = (cluster.safety || []).filter((s) => inRegion(s, regionId, countryCode));
  return [...list.filter((s) => s.urgent), ...list.filter((s) => !s.urgent)];
}

/** Up to n quick, kitchen-fitting recipes for "First week here", fastest first. */
export function firstWeekMeals(cluster, regionId, kitchen, countryCode, n = 5) {
  const fits = (cluster.recipes || []).filter((r) => recipeFits(r, regionId, countryCode, kitchen) && r.meal !== 'snack');
  const mins = (r) => activeMinutes(r) ?? 999;
  return fits.slice().sort((a, b) => mins(a) - mins(b)).slice(0, n);
}

/** Plain-text menu for sharing. Always ends with the health line. */
export function menuText(plan, { title, placeName, healthLine, noMatch }) {
  const lines = [`${title}: ${placeName}`, 'For 2 people (x1.5 for a trio).', ''];
  for (const d of plan) {
    lines.push(`Day ${d.day}`);
    for (const m of MEALS) {
      const r = d[m];
      const label = m === 'main' ? 'Main' : m === 'light' ? 'Light meal' : 'Breakfast';
      lines.push(`  ${label}: ${r ? t(r.name) + (r.local_name ? ` (${r.local_name})` : '') : noMatch}`);
    }
  }
  lines.push('', healthLine);
  return lines.join('\n');
}

/** Small stable string hash (FNV-1a, hex). Used for cache names. */
export function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
