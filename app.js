import {
  t, asList, activeMinutes, totalMinutes, isQuick, regionsFor, findRegion, isHighAltitude,
  planWeek, recipeFits, storesFor, marketTip, safetyTip, safetyFor, firstWeekMeals, visiblePrice,
  priceMaxAge, isPriceVisible, inRegion, menuText, hashText, DEFAULT_KITCHEN, MEALS,
} from './logic.js';

const KEY_PLACE = 'mk.place';
const KEY_KITCHEN = 'mk.kitchen';
const NO_MATCH = 'No match for your kitchen; see Cook tips';
const CDC_WATER = 'https://www.cdc.gov/water-emergency/about/';
const TABS = [
  { id: 'cook', label: 'Cook' },
  { id: 'shop', label: 'Shop' },
  { id: 'well', label: 'Stay well' },
];
const MEAL_LABEL = { breakfast: 'Breakfast', main: 'Main', light: 'Light meal', snack: 'Snack' };
const GROUP_LABEL = {
  grain: 'Grains and starches', legume: 'Beans and lentils', vegetable: 'Vegetables', fruit: 'Fruit',
  protein: 'Eggs, fish and meat', fat: 'Oils and fats', other: 'Other',
};
const GROUP_ORDER = ['grain', 'legume', 'vegetable', 'fruit', 'protein', 'fat', 'other'];
const STORE_LABEL = {
  wet_market: 'Market', neighborhood_shop: 'Neighborhood shop', supermarket: 'Supermarket',
  wholesale: 'Wholesale market', bakery: 'Bakery', butcher_fish: 'Butcher or fish seller', street_vendor: 'Vendor',
};
const RANK_LABEL = { cheap: 'Cheaper', mid: 'Middle', dear: 'Costlier' };
const NEED_LABEL = {
  burner: 'one burner', two_burners: 'two burners', fridge: 'fridge', rice_cooker: 'rice cooker',
  pressure_cooker: 'pressure cooker', oven: 'oven', blender: 'blender',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const S = { cfg: null, index: null, place: null, kitchen: { ...DEFAULT_KITCHEN }, data: null, savedOffline: false, keyboardTab: false };
const $ = (sel) => document.querySelector(sel);

// ---------- tiny DOM helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const sourceLink = (url, label = 'Source') =>
  url ? h('a', { class: 'src', href: url, target: '_blank', rel: 'noopener noreferrer' }, label) : null;
const fmtMonth = (ym) => { const [y, m] = String(ym).split('-'); return `${MONTHS[Number(m) - 1] || ''} ${y}`; };

// ---------- storage (may be cleared or blocked) ----------
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } }
function forget(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } }

// ---------- data ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Write the cluster into its own cache, mk-data-<cluster>-<hash>; drop older versions of that cluster only. */
async function cacheCluster(id, text) {
  if (!('caches' in window)) return false;
  try {
    const name = `mk-data-${id}-${hashText(text)}`;
    const url = new URL(`data/clusters/${id}.json`, location.href).href;
    const cache = await caches.open(name);
    await cache.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    for (const k of await caches.keys()) if (k.startsWith(`mk-data-${id}-`) && k !== name) await caches.delete(k);
    return true;
  } catch { return false; }
}

async function isClusterCached(id) {
  if (!('caches' in window)) return false;
  try { return (await caches.keys()).some((k) => k.startsWith(`mk-data-${id}-`)); } catch { return false; }
}

async function loadCluster(id) {
  const url = `data/clusters/${id}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const text = await r.text();
  S.data = JSON.parse(text);
  S.savedOffline = (await isClusterCached(id)) || (await cacheCluster(id, text));
  if (navigator.onLine) refreshCluster(id, text);
}

/** When online, check for a newer copy quietly; never blocks the view. */
async function refreshCluster(id, current) {
  try {
    const r = await fetch(`data/clusters/${id}.json?fresh=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const text = await r.text();
    JSON.parse(text);
    if (hashText(text) !== hashText(current)) {
      S.savedOffline = await cacheCluster(id, text);
      if (S.place?.cluster === id) { S.data = JSON.parse(text); render(); }
    } else if (!S.savedOffline) {
      S.savedOffline = await cacheCluster(id, text);
    }
  } catch { /* offline or bad copy: keep what we have */ }
}

function clusterOf(code) {
  return S.index.clusters.find((c) => c.countries.some((x) => x.code === code)) || null;
}
function countryObj() { return (S.data?.countries || []).find((c) => c.code === S.place?.country) || null; }
function regionObj() { return S.data ? findRegion(S.data, S.place.country, S.place.region) : null; }
function placeName() {
  const c = countryObj(); const r = regionObj();
  const regions = S.data ? regionsFor(S.data, S.place.country) : [];
  return regions.length > 1 && r ? `${t(c?.name)}, ${t(r.name)}` : t(c?.name);
}

// ---------- shared pieces ----------
function kitchenSummary() {
  const k = S.kitchen;
  const parts = [k.burners >= 2 ? 'two burners' : 'one burner', k.fridge === 'yes' ? 'fridge' : k.fridge === 'unreliable' ? 'fridge (unreliable, treated as none)' : 'no fridge'];
  for (const n of ['rice_cooker', 'pressure_cooker', 'oven', 'blender']) if (k[n]) parts.push(NEED_LABEL[n]);
  return h('div', { class: 'kitchen-line' },
    h('p', null, h('strong', null, 'Your kitchen: '), parts.join(', ') + '.'),
    h('button', { class: 'btn', type: 'button', onclick: openKitchen }, 'Set up kitchen'));
}

function recipeCard(r) {
  const act = activeMinutes(r); const tot = totalMinutes(r);
  const timeText = act != null && tot != null && act !== tot ? `${act} min active, ${tot} min total` : tot != null ? `${tot} min` : '';
  const allergens = Array.isArray(r.allergens) ? r.allergens : null;
  const hazards = (S.data?.staples || []).filter((s) => s.prep_hazard && asList(r.staples).includes(s.id));
  return h('details', { class: 'recipe' },
    h('summary', null,
      h('span', { class: 'r-name' }, t(r.name)),
      r.local_name ? h('span', { class: 'r-local' }, r.local_name) : null,
      h('span', { class: 'r-meta' },
        isQuick(r) ? h('span', { class: 'badge quick' }, '15 min') : null,
        timeText ? h('span', null, timeText) : null)),
    h('div', { class: 'r-body' },
      h('p', { class: 'muted' }, `Serves ${r.serves ?? 2}`, r.serves && r.serves !== 2 ? ' (scale to 2)' : '', '. Needs: ',
        asList(r.needs).map((n) => NEED_LABEL[n] || n).join(', ') || 'one burner', '.'),
      r.soak_hours ? h('p', { class: 'note' }, `Soak ${r.soak_hours} hours first.`) : null,
      hazards.map((s) => h('p', { class: 'note' }, t(s.prep_hazard), ' ', sourceLink(s.hazard_source_url, 'Safety source'))),
      h('h4', null, 'Ingredients'), h('ul', null, asList(r.ingredients).map((i) => h('li', null, t(i)))),
      h('h4', null, 'Steps'), h('ol', null, asList(r.steps).map((s) => h('li', null, t(s)))),
      allergens && allergens.length ? h('p', { class: 'note' }, 'Contains: ', allergens.join(', ').replace(/_/g, ' '), '.') : null,
      h('p', null, sourceLink(r.source_url, 'Recipe source'))));
}

function infoCard(item, extraClass = '') {
  return h('article', { class: `card ${extraClass}` },
    item.urgent ? h('p', { class: 'badge urgent-badge' }, 'Get help now') : null,
    h('h3', null, t(item.title)),
    h('p', null, t(item.body)),
    h('p', null, sourceLink(item.source_url)));
}

function altitudeNote() {
  return h('p', { class: 'note' }, 'Your area is high (about 2,000 m or more). If you boil water, boil it for 3 minutes, not 1. ',
    sourceLink(CDC_WATER, 'CDC'));
}

function heading(text, sub) {
  return [h('h1', { tabindex: '-1', id: 'view-title' }, text), sub ? h('p', { class: 'sub' }, sub) : null];
}

// ---------- views ----------
function viewPicker(code) {
  const nodes = [];
  if (code) {
    const c = clusterOf(code);
    const country = c?.countries.find((x) => x.code === code);
    if (!country || !S.data || S.data.id !== c.id) return viewLoading();
    const regions = regionsFor(S.data, code);
    nodes.push(...heading(`Where in ${t(country.name)}?`, 'Pick the part of the country you are in.'));
    nodes.push(h('ul', { class: 'choices' }, regions.map((r) =>
      h('li', null, h('button', { class: 'choice', type: 'button', onclick: () => choosePlace(c.id, code, r.id) }, t(r.name))))));
    nodes.push(h('p', null, h('a', { href: '#/pick' }, 'Back to countries')));
    return nodes;
  }
  nodes.push(...heading('Where are you serving?', S.cfg.hero));
  nodes.push(flagTicker());
  for (const c of S.index.clusters) {
    nodes.push(h('h2', null, t(c.name)));
    nodes.push(h('ul', { class: 'choices' }, c.countries.map((x) =>
      h('li', null, h('button', { class: 'choice', type: 'button', onclick: () => pickCountry(c.id, x.code) }, t(x.name))))));
  }
  nodes.push(h('h2', null, 'Somewhere else'));
  nodes.push(h('p', null, h('a', { class: 'btn', href: '#/basics' }, 'My country is not listed')));
  return nodes;
}

/** Flag ticker (design-system.md section 4). The copy exists only for the seamless loop: aria-hidden and out of
 *  tab order, but its flags still pick on tap or click, since they fill part of every cycle on screen. */
function flagTicker() {
  const countries = S.index.clusters.flatMap((c) => c.countries.map((x) => ({ c, x })));
  const list = (copy) => h('ul', { class: 'ticker-list', 'aria-label': copy ? null : 'Countries', 'aria-hidden': copy ? 'true' : null },
    countries.map(({ c, x }, i) => h('li', null, h('button', {
      class: 'flag-btn', type: 'button', tabindex: !copy && i === 0 ? '0' : '-1',
      onclick: () => pickCountry(c.id, x.code),
    }, h('img', { src: `flags/${x.code.toLowerCase()}.svg`, alt: '', width: '64', height: '48' }), h('span', null, t(x.name))))));
  const ticker = h('div', { class: 'ticker' }, h('div', { class: 'ticker-track' }, list(false), list(true)));
  const toggle = h('button', { class: 'btn', type: 'button', id: 'ticker-toggle' }, 'Pause flags');
  const setPaused = (on) => {
    if (on) ticker.setAttribute('data-paused', ''); else ticker.removeAttribute('data-paused');
    toggle.textContent = on ? 'Play flags' : 'Pause flags';
  };
  toggle.addEventListener('click', () => setPaused(!ticker.hasAttribute('data-paused')));
  ticker.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setPaused(true); });
  // The track moves by transform, which scrolling cannot undo. While focus is inside, freeze it as a scroll
  // offset instead (data-manual drops the animation) so scrollIntoView can reach any flag; resume from there on leave.
  const track = ticker.firstChild;
  ticker.addEventListener('focusin', (e) => {
    if (!ticker.hasAttribute('data-manual')) {
      const tx = new DOMMatrixReadOnly(getComputedStyle(track).transform.replace('none', 'matrix(1,0,0,1,0,0)')).m41;
      ticker.setAttribute('data-manual', '');
      ticker.scrollLeft = -tx;
    }
    e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  ticker.addEventListener('focusout', (e) => {
    if (ticker.contains(e.relatedTarget)) return;
    const half = track.offsetWidth / 2;
    const dur = parseFloat(getComputedStyle(track).animationDuration) || 60;
    track.style.animationDelay = `${-((ticker.scrollLeft % half) / half) * dur}s`;
    ticker.scrollLeft = 0;
    ticker.removeAttribute('data-manual');
  });
  ticker.addEventListener('keydown', (e) => {
    const btns = [...ticker.querySelectorAll('.ticker-list:not([aria-hidden]) .flag-btn')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    if (j == null) return;
    e.preventDefault();
    btns[i].tabIndex = -1; btns[j].tabIndex = 0; btns[j].focus();
  });
  return h('section', { class: 'ticker-wrap', 'aria-labelledby': 'ticker-h' },
    h('h2', { class: 'sr-only', id: 'ticker-h' }, 'Pick by flag'),
    h('div', { class: 'ticker-bar' }, toggle), ticker);
}

function viewBasics() {
  const b = S.index.basics;
  return [
    ...heading('We haven\'t researched your area yet', 'These basics work anywhere.'),
    h('article', { class: 'card' },
      h('h2', null, t(b.title)),
      h('ul', null, b.items.map((i) => h('li', null, t(i)))),
      h('p', null, sourceLink(b.source_url, b.source_name))),
    h('p', { class: 'note' }, S.cfg.waterLine),
    h('h2', null, 'Not covered yet'),
    h('p', { class: 'muted' }, 'No local recipes, markets or prices for these places yet:'),
    h('ul', { class: 'plain-list' }, S.index.not_covered.map((n) => h('li', null, t(n)))),
    h('p', null, h('a', { href: '#/pick' }, 'Back to the list of covered countries')),
  ];
}

function viewHome() {
  const { region: regionId, country } = S.place;
  const region = regionObj();
  const meals = firstWeekMeals(S.data, regionId, S.kitchen, country, 5);
  const tip = marketTip(S.data, regionId, country);
  const safe = safetyTip(S.data, regionId, country, region);
  const high = isHighAltitude(region);
  return [
    ...heading('First week here', placeName()),
    h('p', { class: 'hero' }, S.cfg.hero),
    S.savedOffline ? h('p', { class: 'saved', id: 'saved' }, 'Saved for offline') : null,
    kitchenSummary(),
    h('section', { 'aria-labelledby': 'meals-h' },
      h('h2', { id: 'meals-h' }, 'Meals to cook this week'),
      meals.length ? h('div', { class: 'stack' }, meals.map(recipeCard)) : h('p', { class: 'note' }, NO_MATCH)),
    tip ? h('section', { class: 'card', 'aria-labelledby': 'market-h' },
      h('h2', { id: 'market-h' }, 'Market tip'),
      tip.store ? h('p', null, h('strong', null, STORE_LABEL[tip.store.type] || 'Shop'),
        tip.store.local_names?.length ? ` (${tip.store.local_names.join(', ')})` : '') : null,
      h('p', null, tip.text),
      tip.store ? h('p', null, sourceLink(tip.store.source_url)) : null) : null,
    safe ? h('section', { class: 'card', 'aria-labelledby': 'safety-h' },
      h('h2', { id: 'safety-h' }, 'Safety tip'),
      h('h3', null, t(safe.title)), h('p', null, t(safe.body)),
      high && !/3 minutes/i.test(t(safe.body)) ? altitudeNote() : null,
      h('p', null, sourceLink(safe.source_url))) : null,
    h('nav', { class: 'go', 'aria-label': 'Sections' },
      TABS.map((x) => h('a', { class: 'btn go-btn', href: `#/${x.id}` }, x.label))),
  ];
}

function tabList(active) {
  const list = h('div', { role: 'tablist', 'aria-label': 'Sections', class: 'tabs' },
    TABS.map((x) => h('button', {
      role: 'tab', type: 'button', id: `tab-${x.id}`, 'aria-controls': 'panel',
      'aria-selected': x.id === active ? 'true' : 'false', tabindex: x.id === active ? '0' : '-1',
      onclick: () => { location.hash = `#/${x.id}`; },
    }, x.label)));
  list.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((x) => x.id === active);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j == null) return;
    e.preventDefault();
    S.keyboardTab = true;
    location.hash = `#/${TABS[j].id}`;
  });
  return list;
}

function viewTab(tab) {
  const body = tab === 'cook' ? panelCook() : tab === 'shop' ? panelShop() : panelWell();
  return [
    h('h1', { class: 'place', tabindex: '-1', id: 'view-title' }, placeName()),
    h('p', null, h('a', { href: '#/home' }, 'Back to First week here')),
    tabList(tab),
    h('section', { role: 'tabpanel', id: 'panel', 'aria-labelledby': `tab-${tab}`, tabindex: '0' }, body),
  ];
}

function panelCook() {
  const { region, country } = S.place;
  const plan = planWeek(S.data, region, S.kitchen, country);
  const all = (S.data.recipes || []).filter((r) => inRegion(r, region, country));
  const fit = all.filter((r) => recipeFits(r, region, country, S.kitchen));
  const mains = fit.filter((r) => r.meal !== 'snack');
  const snacks = fit.filter((r) => r.meal === 'snack');
  const tech = (S.data.techniques || []).filter((x) => inRegion(x, region, country));
  const b = S.index.basics;
  return [
    h('h2', { class: 'sr-only' }, 'Cook'),
    kitchenSummary(),
    h('p', { class: 'muted' }, S.cfg.kitchenDefault),
    h('section', { 'aria-labelledby': 'week-h' },
      h('h3', { id: 'week-h' }, 'Your week'),
      plan.length ? [
        h('p', { class: 'muted' }, 'For 2 people. For a trio, make about 1.5 times as much.'),
        h('ol', { class: 'week' }, plan.map((d) => h('li', { class: 'day' },
          h('h4', null, `Day ${d.day}`),
          MEALS.map((m) => h('div', { class: 'slot' },
            h('span', { class: 'slot-label' }, MEAL_LABEL[m]),
            d[m] ? recipeCard(d[m]) : h('p', { class: 'note' }, NO_MATCH)))))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'copy-menu', onclick: () => copyMenu(plan) }, 'Copy menu as text')),
      ] : h('p', { class: 'note' }, 'No weekly menu for this area yet. The recipes below fit your kitchen.')),
    h('section', { 'aria-labelledby': 'all-h' },
      h('h3', { id: 'all-h' }, 'All recipes for your area'),
      mains.length ? h('div', { class: 'stack' }, mains.map(recipeCard)) : h('p', { class: 'note' }, NO_MATCH),
      all.length > fit.length ? h('p', { class: 'muted' }, `${all.length - fit.length} more need equipment you did not tick.`) : null),
    snacks.length ? h('section', null, h('h3', null, 'Snacks'), h('div', { class: 'stack' }, snacks.map(recipeCard))) : null,
    tech.length ? h('section', { 'aria-labelledby': 'tips-h' },
      h('h3', { id: 'tips-h' }, 'Cook tips'), tech.map((x) => infoCard(x))) : null,
    h('section', { class: 'card', 'aria-labelledby': 'enough-h' },
      h('h3', { id: 'enough-h' }, 'Eating enough, and well'),
      h('ul', null, b.items.map((i) => h('li', null, t(i)))),
      h('p', null, sourceLink(b.source_url, b.source_name))),
  ];
}

function panelShop() {
  const { region, country } = S.place;
  const now = Date.now();
  const stores = storesFor(S.data, region, country);
  const staples = (S.data.staples || []).filter((s) => inRegion(s, region, country));
  const maxAge = priceMaxAge(countryObj());
  let shown = 0; let stale = 0;
  const rows = staples.map((s) => {
    const p = visiblePrice(s, S.data, country, region, now, S.cfg.buildDate);
    if (p) shown++;
    else if (s.price?.observed && (s.price.regions ? inRegion(s.price, region, country) : false)
      && !isPriceVisible(s.price.observed, now, S.cfg.buildDate, maxAge)) stale++;
    return { s, p };
  });
  const groups = GROUP_ORDER.map((g) => [g, rows.filter((r) => (r.s.group || 'other') === g)]).filter(([, l]) => l.length);
  return [
    h('h2', { class: 'sr-only' }, 'Shop'),
    h('section', { 'aria-labelledby': 'stores-h' },
      h('h3', { id: 'stores-h' }, 'Where to shop'),
      stores.length ? stores.map((st) => h('article', { class: 'card' },
        h('h4', null, STORE_LABEL[st.type] || st.type, st.local_names?.length ? ` (${st.local_names.join(', ')})` : ''),
        h('p', null, t(st.tip)), h('p', null, sourceLink(st.source_url)))) : h('p', { class: 'muted' }, 'No store notes for this area yet.')),
    h('section', { 'aria-labelledby': 'staples-h' },
      h('h3', { id: 'staples-h' }, 'Staples'),
      shown === 0 ? h('p', { class: 'note', id: 'no-prices' }, 'No recent official price data for this area yet.') : null,
      stale ? h('p', { class: 'note' }, `Price data older than ${maxAge} months, hidden. Relative costs still shown.`) : null,
      groups.map(([g, list]) => [
        h('h4', null, GROUP_LABEL[g] || g),
        h('ul', { class: 'staples' }, list.map(({ s, p }) => h('li', null,
          h('span', { class: 'st-name' }, t(s.name)),
          s.local_name ? h('span', { class: 'r-local' }, s.local_name) : null,
          s.cost_rank ? h('span', { class: `badge rank-${s.cost_rank}` }, RANK_LABEL[s.cost_rank] || s.cost_rank) : null,
          p ? h('span', { class: 'price' },
            `${p.currency} ${p.low === p.high || p.high == null ? p.low : `${p.low}-${p.high}`} per ${p.unit}`,
            p.market ? `, ${p.market}` : '', `, ${fmtMonth(p.observed)}, rough estimate. `, sourceLink(p.source_url, 'Price source')) : null,
          [s.shop_hazard, s.prep_hazard].filter(Boolean).map((x) => h('span', { class: 'note' }, t(x), ' ', sourceLink(s.hazard_source_url, 'Safety source'))),
          ' ', sourceLink(s.source_url))))]),
      h('p', { class: 'muted' }, 'Prices are rough estimates, never exact. Cost labels compare foods within this area only.')),
  ];
}

function panelWell() {
  const { region, country } = S.place;
  const list = safetyFor(S.data, region, country);
  return [
    h('h2', { class: 'sr-only' }, 'Stay well'),
    h('p', { class: 'note strong' }, S.cfg.waterLine),
    isHighAltitude(regionObj()) ? altitudeNote() : null,
    list.map((x) => infoCard(x, x.urgent ? 'urgent' : '')),
    h('p', { class: 'card health-card' }, S.cfg.healthLine),
  ];
}

function viewAbout() {
  return [
    ...heading(`About ${S.cfg.appName}`),
    h('p', null, 'Simple, cheap meals for missionaries in a new area: what to cook, where to shop, and how to stay well. Works offline once you pick your area.'),
    h('p', { class: 'note strong' }, S.cfg.approvalLine),
    h('p', null, S.cfg.disclaimer),
    h('h2', null, 'Your data'),
    h('p', null, S.cfg.storageLine, ' Nothing is sent anywhere.'),
    h('h2', null, 'Sources'),
    h('p', null, 'Every recipe, tip and price links to the page it came from. Pages were opened on 2026-10-29. Copies of those pages were not kept, so a page may change after that date.'),
    h('p', null, 'Prices show only when recent official data exists for your exact area, with its date and currency. Older prices hide themselves.'),
    h('p', null, 'Basics for uncovered areas: ', sourceLink(S.index.basics.source_url, S.index.basics.source_name), '.'),
    h('p', null, 'Water boiling times: ', sourceLink(CDC_WATER, 'CDC, Making water safe'), '.'),
    h('h2', null, 'Start over'),
    h('button', { class: 'btn', type: 'button', onclick: resetAll }, 'Clear my area and kitchen'),
    h('p', { class: 'muted' }, `Version ${S.cfg.buildDate}.`),
  ];
}

function viewLoading() { return [h('p', { class: 'loading' }, 'Loading...')]; }
function viewError(msg) {
  return [...heading('Could not load this area'),
    h('p', null, msg),
    h('p', null, 'If you are offline, this area was not saved yet. Connect once and pick it again.'),
    h('p', null, h('a', { href: '#/pick' }, 'Back to the list'))];
}

// ---------- actions ----------
async function pickCountry(clusterId, code) {
  try {
    if (!S.data || S.data.id !== clusterId) { render(viewLoading()); await loadCluster(clusterId); }
  } catch (e) { render(viewError(String(e.message || e))); return; }
  const regions = regionsFor(S.data, code);
  if (regions.length === 1) choosePlace(clusterId, code, regions[0].id);
  else location.hash = `#/pick/${code}`;
}

function choosePlace(cluster, country, region) {
  S.place = { cluster, country, region };
  save(KEY_PLACE, S.place);
  location.hash = '#/home';
}

function resetAll() {
  forget(KEY_PLACE); forget(KEY_KITCHEN);
  S.place = null; S.kitchen = { ...DEFAULT_KITCHEN };
  location.hash = '#/pick';
}

function openKitchen() {
  const dlg = $('#kitchen-sheet'); const f = $('#kitchen-form');
  f.fridge.value = S.kitchen.fridge; f.burners.value = String(S.kitchen.burners >= 2 ? 2 : 1);
  for (const n of ['rice_cooker', 'pressure_cooker', 'oven', 'blender']) f[n].checked = !!S.kitchen[n];
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

function onKitchenSubmit(e) {
  e.preventDefault();
  const f = $('#kitchen-form');
  if (e.submitter?.value === 'save') {
    S.kitchen = {
      fridge: f.fridge.value || 'no', burners: Number(f.burners.value || 2),
      rice_cooker: f.rice_cooker.checked, pressure_cooker: f.pressure_cooker.checked, oven: f.oven.checked, blender: f.blender.checked,
    };
    save(KEY_KITCHEN, S.kitchen);
  }
  $('#kitchen-sheet').close();
  render();
}

async function copyMenu(plan) {
  const text = menuText(plan, { title: `${S.cfg.appName} week menu`, placeName: placeName(), healthLine: S.cfg.healthLine, noMatch: NO_MATCH });
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = h('textarea', { class: 'sr-only', readonly: true }); ta.value = text;
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? 'Menu copied. Paste it into a message or note.' : 'Could not copy on this phone.');
}

let toastTimer = 0;
function toast(msg, action) {
  const el = $('#toast');
  el.replaceChildren(h('span', null, msg), action ? h('button', { class: 'btn', type: 'button', onclick: action.run }, action.label) : null);
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- flag palette: data-cc picks a block in palettes.css; no country restores the default ----------
function applyFlag() {
  const root = document.documentElement;
  if (S.place?.country) root.dataset.cc = S.place.country; else delete root.dataset.cc;
  const css = getComputedStyle(root);
  for (const mode of ['light', 'dark']) {
    const v = css.getPropertyValue(`--theme-${mode}`).trim();
    const meta = document.querySelector(`meta[name="theme-color"][media*="${mode}"]`);
    if (v && meta) meta.content = v;
  }
}

// ---------- router ----------
let current = [];
function render(nodes) {
  if (nodes) current = nodes; else { route(); return; }
  applyFlag();
  const view = $('#view');
  view.replaceChildren(...current.flat(Infinity).filter(Boolean));
  $('#place-link').hidden = !S.place;
  if (S.keyboardTab) {
    S.keyboardTab = false;
    view.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || (S.place ? 'home' : 'pick');
  if (name === 'about') return render(viewAbout());
  if (name === 'basics') return render(viewBasics());
  if (name === 'pick') {
    if (parts[1] && (!S.data || !S.data.countries.some((c) => c.code === parts[1]))) {
      const c = clusterOf(parts[1]);
      if (c) { try { render(viewLoading()); await loadCluster(c.id); } catch (e) { return render(viewError(String(e.message || e))); } }
    }
    return render(viewPicker(parts[1]));
  }
  if (!S.place) { location.hash = '#/pick'; return; }
  if (!S.data || S.data.id !== S.place.cluster) {
    render(viewLoading());
    try { await loadCluster(S.place.cluster); } catch (e) { return render(viewError(String(e.message || e))); }
  }
  if (!findRegion(S.data, S.place.country, S.place.region)) { forget(KEY_PLACE); S.place = null; location.hash = '#/pick'; return; }
  if (TABS.some((x) => x.id === name)) return render(viewTab(name));
  return render(viewHome());
}

let lastName = null;
window.addEventListener('hashchange', async () => {
  await route();
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  const isTab = TABS.some((x) => x.id === name);
  if (!(isTab && TABS.some((x) => x.id === lastName))) {
    window.scrollTo(0, 0);
    if (!document.activeElement || document.activeElement === document.body || !$('#view').contains(document.activeElement)) {
      ($('#view-title') || $('#view')).focus({ preventScroll: true });
    }
  }
  lastName = name;
});

// ---------- service worker + update toast ----------
function setupSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false; let wantReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller || !navigator.onLine) return;
      toast('A new version is ready.', { label: 'Update', run: () => { wantReload = true; reg.waiting?.postMessage('SKIP_WAITING'); } });
    };
    offer();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', (e) => { if (e.target.state === 'installed') offer(); });
    });
    window.addEventListener('online', offer);
  }).catch(() => { /* no offline support on this browser */ });
}

// ---------- boot ----------
async function boot() {
  try {
    [S.cfg, S.index] = await Promise.all([getJSON('config.json'), getJSON('data/index.json')]);
  } catch {
    $('#view').replaceChildren(h('p', { class: 'card' }, 'Could not start. Connect to the internet once, then reload.'));
    return;
  }
  document.title = S.cfg.appName;
  $('#brand').textContent = S.cfg.appName;
  $('#health-line').textContent = S.cfg.healthLine;
  $('#disclaimer').textContent = S.cfg.disclaimer;
  $('#kitchen-default').textContent = S.cfg.kitchenDefault;
  $('#kitchen-form').addEventListener('submit', onKitchenSubmit);
  const k = load(KEY_KITCHEN);
  if (k && typeof k === 'object') S.kitchen = { ...DEFAULT_KITCHEN, ...k };
  const p = load(KEY_PLACE);
  if (p && p.cluster && p.country && p.region && clusterOf(p.country)?.id === p.cluster) S.place = p;
  await route();
  lastName = location.hash.replace(/^#\/?/, '').split('/')[0];
  setupSW();
}

boot();
