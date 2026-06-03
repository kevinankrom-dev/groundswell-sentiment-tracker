const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: { item: ['source'] },
  timeout: 10000,
});

// ─── Risk scoring ────────────────────────────────────────────────────────────

const HIGH_RISK = [
  'petition', 'opposition', 'oppose', 'opposed', 'protest', 'protesting',
  'reject', 'rejected', 'deny', 'denied', 'lawsuit', 'sue', 'suing', 'sued',
  'injunction', 'ban', 'banned', 'block', 'blocked', 'fight', 'fighting',
  'backlash', 'outrage', 'angry', 'anger', 'furious', 'concerned residents',
  'residents against', 'community against', 'neighbors against', 'halt',
  'moratorium', 'appeal', 'appealed', 'challenge', 'challenged',
];

const LOW_RISK = [
  'support', 'supports', 'supported', 'approve', 'approved', 'approval',
  'benefit', 'benefits', 'opportunity', 'economic growth', 'jobs',
  'welcome', 'progress', 'forward', 'partnership',
];

function scoreRisk(title = '', snippet = '') {
  const text = (title + ' ' + snippet).toLowerCase();
  const highHits = HIGH_RISK.filter(w => text.includes(w)).length;
  const lowHits = LOW_RISK.filter(w => text.includes(w)).length;
  if (highHits > 0) return 'high';
  if (lowHits > 0) return 'low';
  return 'medium';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url = '') {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return 'Unknown'; }
}

function extractSource(item) {
  if (item.source?.['_']) return item.source['_'];
  if (item.source?.name) return item.source.name;
  if (item.title?.includes(' - ')) {
    const parts = item.title.split(' - ');
    return parts[parts.length - 1].trim();
  }
  return extractDomain(item.link);
}

function cleanTitle(title = '') {
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    parts.pop();
    return parts.join(' - ').trim();
  }
  return title;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  if (isNaN(date)) return dateStr;
  const diff = Date.now() - date.getTime();
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const feed = await parser.parseURL(url);
    return feed.items || [];
  } catch (e) {
    console.error(`[RSS] Failed: ${query.slice(0, 60)}… — ${e.message}`);
    return [];
  }
}

const TOPIC_SUBREDDITS = {
  'Data Center':       ['localgovernment', 'urbanplanning', 'environment', 'energy', 'sustainability'],
  'Solar Farm':        ['localgovernment', 'environment', 'energy', 'renewableenergy', 'sustainability'],
  'Wind Project':      ['localgovernment', 'environment', 'energy', 'renewableenergy', 'sustainability'],
  'Battery Storage':   ['localgovernment', 'environment', 'energy', 'renewableenergy', 'sustainability'],
  'Transmission Line': ['localgovernment', 'urbanplanning', 'environment', 'energy', 'infrastructure'],
};

const BASE_SUBREDDITS = ['localgovernment', 'urbanplanning', 'environment', 'energy'];

const STATE_SUBS = {
  'tx': 'texas', 'texas': 'texas',
  'ca': 'california', 'california': 'california',
  'ny': 'newyork', 'new york': 'newyork',
  'fl': 'florida', 'florida': 'florida',
  'az': 'arizona', 'arizona': 'arizona',
  'nv': 'nevada', 'nevada': 'nevada',
  'co': 'colorado', 'colorado': 'colorado',
  'wa': 'washington', 'washington': 'washington',
  'or': 'oregon', 'oregon': 'oregon',
  'nc': 'northcarolina', 'north carolina': 'northcarolina',
  'ga': 'georgia', 'georgia': 'georgia',
  'va': 'virginia', 'virginia': 'virginia',
  'oh': 'ohio', 'ohio': 'ohio',
  'il': 'illinois', 'illinois': 'illinois',
};

function citySlug(city) {
  return city.split(/,/)[0].trim().replace(/\s+/g, '');
}

function stateSlug(city) {
  const parts = city.split(/,\s*/);
  if (parts.length < 2) return null;
  const abbr = parts[1].trim().toLowerCase();
  return STATE_SUBS[abbr] || null;
}

async function redditSearch(subreddits, query, restrictToSubs) {
  const subPath = subreddits.join('+');
  const base = restrictToSubs
    ? `https://www.reddit.com/r/${subPath}/search.json?restrict_sr=1`
    : `https://www.reddit.com/search.json?`;
  const url = `${base}q=${encodeURIComponent(query)}&sort=new&limit=10&type=link`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Groundswell/1.0 (infrastructure research)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const json = await res.json();
  return (json.data?.children || []).map(c => c.data);
}

async function fetchReddit(city, topic, kwList) {
  const topicSubs = [...new Set([...(TOPIC_SUBREDDITS[topic] || BASE_SUBREDDITS), ...BASE_SUBREDDITS])];
  const slug = citySlug(city);
  const state = stateSlug(city);
  const kw = kwList.slice(0, 2).join(' ');

  try {
    const [cityPosts, statePosts, topicPosts] = await Promise.allSettled([
      redditSearch([slug], `${topic} ${kw}`, true),
      state ? redditSearch([state], `${topic} opposition residents zoning`, true) : Promise.resolve([]),
      redditSearch(topicSubs, `${topic} opposition zoning permit residents`, true),
    ]);

    const combined = [
      ...(cityPosts.status  === 'fulfilled' ? cityPosts.value  : []),
      ...(statePosts.status === 'fulfilled' ? statePosts.value : []),
      ...(topicPosts.status === 'fulfilled' ? topicPosts.value : []),
    ];

    const seen = new Set();
    const deduped = combined.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    return deduped.slice(0, 6);
  } catch (e) {
    console.error(`[Reddit] ${e.message}`);
    return [];
  }
}

function rssItemToCard(item, id) {
  const title = cleanTitle(item.title || 'Untitled');
  const snippet = item.contentSnippet?.replace(/<[^>]+>/g, '').slice(0, 220);
  return {
    id,
    title,
    source: extractSource(item),
    date: formatDate(item.pubDate || item.isoDate),
    risk: scoreRisk(title, snippet),
    link: item.link,
    snippet,
  };
}

// ─── Query template library ───────────────────────────────────────────────────

const QUERY_TEMPLATES = {
  meetings_council:     (b)     => `${b} ("council meeting" OR "planning commission" OR "public hearing" OR "meeting minutes")`,
  meetings_staff:       (b)     => `${b} ("staff report" OR "agenda item" OR "docket" OR "resolution")`,
  meetings_board:       (b)     => `${b} ("board of supervisors" OR "county commission" OR "city council vote")`,
  social_opposition:    (b)     => `${b} (petition OR "community opposition" OR "residents oppose" OR "neighbors oppose" OR "public backlash" OR protest OR "NextDoor" OR "Facebook group" OR "citizens against" OR grassroots)`,
  social_nextdoor:      (b)     => `${b} (NextDoor OR "neighborhood association" OR "Facebook group" OR "community group" OR "local residents")`,
  social_rally:         (b)     => `${b} (rally OR demonstration OR "citizens against" OR "community fight" OR "residents rally" OR "sign petition")`,
  apps_permits:         (b)     => `${b} (permit OR variance OR "permit application" OR "conditional use" OR "special use permit")`,
  apps_env:             (b)     => `${b} ("environmental impact" OR EIR OR EIS OR CEQA OR NEPA OR "environmental review")`,
  apps_ferc:            (b)     => `${b} (FERC OR "utility commission" OR PUC OR "interconnection" OR "grid connection" OR "rate case")`,
  townhalls_general:    (b)     => `${b} ("town hall" OR townhall OR "community meeting" OR "public comment" OR "comment period")`,
  townhalls_notice:     (b)     => `${b} ("public notice" OR "scoping meeting" OR "notice of preparation" OR "notice of intent")`,
  townhalls_hearing:    (b)     => `${b} ("commission hearing" OR "board hearing" OR "administrative hearing" OR "public session")`,
  news_general:         (b, kw) => `${b}${kw}`,
  news_editorial:       (b)     => `${b} (editorial OR opinion OR "letter to the editor" OR commentary)`,
  news_investigative:   (b)     => `${b} (investigative OR "special report" OR "exclusive" OR "deep dive")`,
  zoning_general:       (b)     => `${b} (zoning OR "land use" OR rezoning OR setback OR "overlay district")`,
  zoning_moratorium:    (b)     => `${b} (moratorium OR "development hold" OR "temporary ban" OR "pause" OR "freeze")`,
  zoning_code:          (b)     => `${b} ("zoning ordinance" OR "municipal code" OR "development standards" OR "code amendment")`,
  env_impact:           (b)     => `${b} ("environmental impact" OR EIR OR EIS OR CEQA OR NEPA OR "air quality" OR "water quality" OR "stormwater")`,
  env_wildlife:         (b)     => `${b} ("endangered species" OR wetlands OR habitat OR wildlife OR conservation OR "Sierra Club" OR "environmental group" OR "nature conservancy")`,
  env_epa:              (b)     => `${b} (EPA OR "Clean Air Act" OR "Clean Water Act" OR "hazardous materials" OR "toxic" OR remediation OR superfund)`,
  political_officials:  (b)     => `${b} (senator OR congressman OR "city council" OR mayor OR governor OR "elected official" OR "state representative" OR "county supervisor")`,
  political_campaign:   (b)     => `${b} ("ballot measure" OR referendum OR "executive order" OR "signed into law" OR "veto" OR "campaign" OR "campaign contribution")`,
  political_lobby:      (b)     => `${b} (lobbying OR "political opposition" OR "advocacy group" OR PAC OR "special interest" OR "industry group")`,
  legislative_state:    (b)     => `${b} ("state bill" OR "senate bill" OR "house bill" OR ordinance OR "SB" OR "HB" OR "AB" OR "state legislature")`,
  legislative_federal:  (b)     => `${b} (congress OR "federal legislation" OR "IRA" OR "infrastructure law" OR "federal grant" OR DOE OR DOD OR "permitting reform")`,
  legislative_local:    (b)     => `${b} ("city ordinance" OR "county ordinance" OR "local law" OR "municipal resolution" OR "board of supervisors vote")`,
  grid_ferc:            (b)     => `${b} (FERC OR interconnection OR "grid connection" OR "transmission" OR "utility commission" OR "rate case")`,
  grid_operator:        (b)     => `${b} (PUC OR "public utility" OR ISO OR RTO OR ERCOT OR PJM OR MISO OR CAISO OR "grid operator" OR "balancing authority")`,
  grid_queue:           (b)     => `${b} ("interconnection queue" OR "grid queue" OR curtailment OR "grid upgrade" OR substation OR "capacity constraint" OR "queue delay")`,
};

const QUERY_WIDGET = {
  meetings_council: 'meetings',       meetings_staff: 'meetings',         meetings_board: 'meetings',
  social_opposition: 'social',        social_nextdoor: 'social',          social_rally: 'social',
  apps_permits: 'applications',       apps_env: 'applications',           apps_ferc: 'applications',
  townhalls_general: 'townhalls',     townhalls_notice: 'townhalls',      townhalls_hearing: 'townhalls',
  news_general: 'news',               news_editorial: 'news',             news_investigative: 'news',
  zoning_general: 'zoning',           zoning_moratorium: 'zoning',        zoning_code: 'zoning',
  env_impact: 'environmental',        env_wildlife: 'environmental',      env_epa: 'environmental',
  political_officials: 'political',   political_campaign: 'political',    political_lobby: 'political',
  legislative_state: 'legislative',   legislative_federal: 'legislative', legislative_local: 'legislative',
  grid_ferc: 'grid',                  grid_operator: 'grid',              grid_queue: 'grid',
};

const DEFAULT_QUERIES = [
  'meetings_council', 'social_opposition', 'apps_permits', 'apps_env',
  'townhalls_general', 'news_general', 'zoning_general',
  'env_impact', 'political_officials', 'legislative_state', 'grid_ferc',
];

app.get('/api/query-library', (req, res) => {
  res.json({ templates: Object.keys(QUERY_TEMPLATES), defaults: DEFAULT_QUERIES });
});

// ─── Main route ───────────────────────────────────────────────────────────────

app.get('/api/feeds', async (req, res) => {
  const { city, topic, keywords = '', queries: queriesParam } = req.query;
  if (!city || !topic) return res.status(400).json({ error: 'city and topic required' });

  const kwList = keywords.split(',').map(k => k.trim()).filter(Boolean);
  const kwOr = kwList.length ? ` (${kwList.map(k => `"${k}"`).join(' OR ')})` : '';
  const base = `"${topic}" "${city}"`;

  const activeIds = queriesParam
    ? queriesParam.split(',').map(s => s.trim()).filter(id => QUERY_TEMPLATES[id])
    : DEFAULT_QUERIES;

  const widgetIds = {};
  for (const id of activeIds) {
    const w = QUERY_WIDGET[id];
    if (w && w !== 'social') (widgetIds[w] ??= []).push(id);
  }

  const socialIds = activeIds.filter(id => QUERY_WIDGET[id] === 'social');
  const hasSocial  = socialIds.length > 0;

  const fetchJobs = [
    ...Object.entries(widgetIds).flatMap(([w, ids]) =>
      ids.map(id => ({ w, id, p: fetchGoogleNews(QUERY_TEMPLATES[id](base, kwOr)) }))
    ),
    ...socialIds.map(id => ({ w: 'social_news', id, p: fetchGoogleNews(QUERY_TEMPLATES[id](base, kwOr)) })),
    { w: '_reddit', id: '_reddit', p: hasSocial ? fetchReddit(city, topic, kwList) : Promise.resolve([]) },
  ];

  const settled = await Promise.allSettled(fetchJobs.map(j => j.p));
  const results = fetchJobs.map((j, i) => ({
    ...j,
    items: settled[i].status === 'fulfilled' ? settled[i].value : [],
  }));

  const buckets = { meetings: [], applications: [], townhalls: [], news: [], zoning: [], environmental: [], political: [], legislative: [], grid: [] };
  for (const { w, items } of results) {
    if (buckets[w]) buckets[w].push(...items);
  }

  const socialNewsItems = results.filter(r => r.w === 'social_news').flatMap(r => r.items);
  const redditPosts     = results.find(r => r.id === '_reddit')?.items ?? [];

  function dedupe(items) {
    const seen = new Set();
    return items.filter(i => {
      const key = i.link || i.title;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  let id = 1;

  const redditCards = redditPosts.slice(0, 3).map(p => ({
    id: id++,
    title: p.title,
    source: `r/${p.subreddit}`,
    date: formatDate(new Date(p.created_utc * 1000)),
    risk: scoreRisk(p.title, p.selftext),
    link: `https://reddit.com${p.permalink}`,
    snippet: p.selftext?.slice(0, 220) || null,
    platform: 'reddit',
  }));
  const socialNewsCards = socialNewsItems.slice(0, 3).map(i => ({ ...rssItemToCard(i, id++), platform: 'news' }));
  const seenReddit = new Set(redditCards.map(c => c.link));
  const mergedSocial = dedupe([
    ...redditCards,
    ...socialNewsCards.filter(c => !seenReddit.has(c.link)),
  ]).slice(0, 4);

  res.json({
    meetings:      dedupe(buckets.meetings).slice(0, 4).map(i => rssItemToCard(i, id++)),
    social:        mergedSocial,
    applications:  dedupe(buckets.applications).slice(0, 4).map(i => rssItemToCard(i, id++)),
    townhalls:     dedupe(buckets.townhalls).slice(0, 4).map(i => rssItemToCard(i, id++)),
    news:          dedupe(buckets.news).slice(0, 4).map(i => rssItemToCard(i, id++)),
    zoning:        dedupe(buckets.zoning).slice(0, 4).map(i => rssItemToCard(i, id++)),
    environmental: dedupe(buckets.environmental).slice(0, 4).map(i => rssItemToCard(i, id++)),
    political:     dedupe(buckets.political).slice(0, 4).map(i => rssItemToCard(i, id++)),
    legislative:   dedupe(buckets.legislative).slice(0, 4).map(i => rssItemToCard(i, id++)),
    grid:          dedupe(buckets.grid).slice(0, 4).map(i => rssItemToCard(i, id++)),
    activeQueries: activeIds,
  });
});

// ─── Intelligence Brief ───────────────────────────────────────────────────────

const BUCKETS = ['meetings', 'social', 'applications', 'townhalls', 'news', 'zoning', 'environmental', 'political', 'legislative', 'grid'];

const BUCKET_LABELS = {
  meetings: 'council meeting activity', social: 'community opposition signals',
  applications: 'permit application filings', townhalls: 'public hearing engagement',
  news: 'news coverage', zoning: 'zoning & land use activity',
  environmental: 'environmental review signals', political: 'political activity',
  legislative: 'legislative activity', grid: 'grid interconnection signals',
};

function bucketScore(items) {
  if (!items?.length) return { score: 0, level: 'low', high: 0, medium: 0, low: 0, total: 0 };
  const counts = { high: 0, medium: 0, low: 0 };
  for (const item of items) counts[item.risk ?? 'medium']++;
  const weighted = counts.high * 3 + counts.medium * 1;
  const score = Math.round((weighted / (items.length * 3)) * 100);
  const level = score >= 76 ? 'critical' : score >= 51 ? 'high' : score >= 26 ? 'medium' : 'low';
  return { score, level, ...counts, total: items.length };
}

const PERSON_TITLE_RE = /\b(Mayor|Governor|Senator|Representative|Rep\.|Congressman|Congresswoman|Secretary|Director|Commissioner|Supervisor|Councilmember|Council\s+Member|Councilman|Councilwoman|Chairwoman|Chairman|Chair|President|CEO|Executive\s+Director|Trustee|Alderman|Alderperson)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
const ORG_SUFFIX_RE = /\b((?:[A-Z][a-z]+\s){1,5}(?:Coalition|Alliance|Association|Club|Committee|Council|Foundation|Society|Institute|Initiative|Group|League|Watch|Trust|Partnership))\b/g;
const KNOWN_ORGS = [
  'Sierra Club', 'NRDC', 'Earthjustice', 'NextDoor', 'League of Women Voters',
  'Audubon Society', 'Nature Conservancy', 'Clean Air Task Force',
  'ERCOT', 'PJM', 'MISO', 'CAISO', 'ISO-NE', 'SPP', 'FERC',
  'EPA', 'Army Corps of Engineers', 'Fish and Wildlife Service',
];

const OPPOSE_WORDS = ['oppose', 'opposes', 'opposed', 'against', 'fight', 'block', 'reject', 'rejected', 'protest', 'concern', 'worried', 'fear', 'halt', 'ban', 'petition', 'lawsuit', 'appeal'];
const SUPPORT_WORDS = ['support', 'supports', 'approve', 'approved', 'back', 'endorse', 'welcome', 'champion', 'advance', 'promote'];

function detectStance(text) {
  const t = text.toLowerCase();
  const oScore = OPPOSE_WORDS.filter(w => t.includes(w)).length;
  const sScore = SUPPORT_WORDS.filter(w => t.includes(w)).length;
  if (oScore > sScore) return 'opposing';
  if (sScore > oScore) return 'supporting';
  return 'monitoring';
}

const DAYS_MONTHS = new Set([
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'January','February','March','April','May','June','July','August','September','October','November','December',
]);

const GENERIC_FIRST = new Set([
  'city','local','public','state','national','federal','regional','community',
  'general','special','new','old','the','a','an',
]);

function cleanOrgName(raw) {
  const words = raw.trim().split(/\s+/);
  while (words.length > 1 && DAYS_MONTHS.has(words[0])) words.shift();
  return words.join(' ');
}

function isUsefulOrg(name, topicWords) {
  const words = name.split(/\s+/);
  if (words.length < 2) return false;
  const lower = name.toLowerCase();
  if (topicWords.length >= 2 && topicWords.every(w => lower.includes(w.toLowerCase()))) return false;
  if (words.length === 2 && GENERIC_FIRST.has(words[0].toLowerCase())) return false;
  return true;
}

function extractActors(allItems, city, topicWords = []) {
  const map = new Map();

  const add = (rawName, role, stance, knownProper = false) => {
    const displayName = role === 'Organization' ? cleanOrgName(rawName) : rawName.trim();
    if (displayName.length < 3) return;
    if (role === 'Organization' && !knownProper && !isUsefulOrg(displayName, topicWords)) return;
    const key = displayName.toLowerCase().replace(/\s+/g, ' ');
    if (!map.has(key)) map.set(key, { displayName, role, count: 0, opposeVotes: 0, supportVotes: 0 });
    const e = map.get(key);
    e.count++;
    if (stance === 'opposing')   e.opposeVotes++;
    if (stance === 'supporting') e.supportVotes++;
    if (role !== 'Organization' || e.role === 'Organization') e.role = role;
  };

  for (const item of allItems) {
    const text = `${item.title ?? ''} ${item.snippet ?? ''}`;
    const stance = detectStance(text);
    const re1 = new RegExp(PERSON_TITLE_RE.source, 'g');
    let m;
    while ((m = re1.exec(text)) !== null) {
      add(m[2].trim(), m[1].replace(/\s+/g, ' '), stance);
    }
    const re2 = new RegExp(ORG_SUFFIX_RE.source, 'g');
    while ((m = re2.exec(text)) !== null) {
      add(m[1].trim(), 'Organization', stance, false);
    }
    for (const org of KNOWN_ORGS) {
      if (text.includes(org)) add(org, 'Organization', stance, true);
    }
  }

  const KNOWN_ROLES = {
    'ERCOT': 'Grid Operator', 'PJM': 'Grid Operator', 'MISO': 'Grid Operator',
    'CAISO': 'Grid Operator', 'ISO-NE': 'Grid Operator', 'SPP': 'Grid Operator',
    'FERC': 'Federal Regulator', 'EPA': 'Federal Regulator',
    'Army Corps of Engineers': 'Federal Agency',
    'Fish and Wildlife Service': 'Federal Agency',
    'Sierra Club': 'Environmental Group', 'NRDC': 'Environmental Group',
    'Earthjustice': 'Legal Advocacy', 'League of Women Voters': 'Civic Group',
    'Audubon Society': 'Environmental Group', 'Nature Conservancy': 'Environmental Group',
  };

  const toActor = (e) => ({
    name: e.displayName,
    role: KNOWN_ROLES[e.displayName] ?? e.role,
    stance: e.opposeVotes > e.supportVotes ? 'opposing'
          : e.supportVotes > e.opposeVotes ? 'supporting'
          : 'monitoring',
  });

  let ranked = [...map.values()]
    .sort((a, b) => (b.count + b.opposeVotes * 2) - (a.count + a.opposeVotes * 2))
    .slice(0, 5)
    .map(toActor);

  if (ranked.length < 4) {
    const seenNames = new Set(ranked.map(a => a.name.toLowerCase()));
    const sourceCounts = {};
    for (const item of allItems) {
      if (!item.source) continue;
      sourceCounts[item.source] = (sourceCounts[item.source] ?? 0) + (item.risk === 'high' ? 2 : 1);
    }
    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([src]) => src)
      .filter(s => !seenNames.has(s.toLowerCase()) && s.length > 3)
      .slice(0, 4 - ranked.length);
    for (const src of topSources) {
      ranked.push({ name: src, role: 'News Coverage', stance: 'monitoring' });
    }
  }

  const cityName = city.split(',')[0].trim();
  const hasPlanning = ranked.some(a => a.name.toLowerCase().includes('planning') || a.name.toLowerCase().includes('commission'));
  if (!hasPlanning && ranked.length < 6) {
    ranked.push({ name: `${cityName} Planning Commission`, role: 'Regulatory Body', stance: 'monitoring' });
  }

  return ranked.slice(0, 6);
}

function computeBrief(city, topic, keywords, feeds) {
  const allItems = BUCKETS.flatMap(b => (feeds[b] ?? []).map(i => ({ ...i, bucket: b })));
  if (allItems.length === 0) return null;

  const totalHigh   = allItems.filter(i => i.risk === 'high').length;
  const totalMedium = allItems.filter(i => i.risk === 'medium').length;
  const total       = allItems.length;
  const weighted    = totalHigh * 3 + totalMedium * 1;
  const riskScore   = Math.round((weighted / (total * 3)) * 100);
  const riskLevel   = riskScore >= 76 ? 'critical' : riskScore >= 51 ? 'high' : riskScore >= 26 ? 'medium' : 'low';

  const activeBuckets = BUCKETS
    .filter(b => (feeds[b]?.length ?? 0) > 0)
    .sort((a, b) => bucketScore(feeds[b]).score - bucketScore(feeds[a]).score);

  const topTwo = activeBuckets.slice(0, 2).map(b => BUCKET_LABELS[b]);

  const executiveSummary =
    `Signal analysis for a ${topic} project in ${city} identifies ${totalHigh} high-risk signal${totalHigh !== 1 ? 's' : ''} out of ${total} total items monitored, yielding a composite risk score of ${riskScore}/100 (${riskLevel}). ` +
    `The strongest risk concentration appears in ${topTwo.join(' and ')}. ` +
    (riskLevel === 'critical' || riskLevel === 'high'
      ? 'Immediate community engagement and regulatory pre-consultation are advised before proceeding.'
      : riskLevel === 'medium'
      ? 'Proactive stakeholder outreach is recommended to prevent signal escalation.'
      : 'Risk signals are currently contained — maintain monitoring cadence to catch early escalation.');

  const oppositionItems = [...(feeds.social ?? []), ...(feeds.townhalls ?? []), ...(feeds.meetings ?? [])]
    .filter(i => i.risk === 'high').slice(0, 3);

  const oppositionLandscape = oppositionItems.length > 0
    ? (() => {
        const sources = [...new Set(oppositionItems.map(i => i.source).filter(Boolean))].slice(0, 3);
        return `Active opposition signals have been detected in ${city} around ${topic} development. ` +
          `Recent high-risk items from ${sources.length > 0 ? sources.join(', ') : 'community sources'} suggest organized community concern. ` +
          (totalHigh >= 3
            ? 'The volume and breadth of opposition signals indicates a coordinated resistance pattern that warrants direct community outreach.'
            : 'Opposition remains limited in scope but should be monitored for escalation, particularly around public comment deadlines.');
      })()
    : `No strong organized opposition has been detected in current signals for a ${topic} in ${city}. ` +
      `Community sentiment appears neutral to mixed, with ${totalMedium} medium-risk signals suggesting latent concern that could be activated during formal permitting phases. ` +
      `Pre-emptive engagement with neighborhood associations and environmental groups is recommended.`;

  const topicWords = topic.split(/\s+/);
  const keyActors = extractActors(allItems, city, topicWords);

  const breakdownDef = {
    communitySentiment: { buckets: ['social', 'townhalls', 'meetings'],    label: 'community sentiment'   },
    regulatory:         { buckets: ['applications', 'zoning'],             label: 'regulatory'            },
    political:          { buckets: ['political'],                           label: 'political'             },
    environmental:      { buckets: ['environmental'],                       label: 'environmental'         },
    legislative:        { buckets: ['legislative'],                         label: 'legislative'           },
    grid:               { buckets: ['grid'],                                label: 'grid interconnection'  },
  };

  const riskBreakdown = {};
  for (const [key, { buckets, label }] of Object.entries(breakdownDef)) {
    const items = buckets.flatMap(b => feeds[b] ?? []);
    const { level, high, medium, total: t } = bucketScore(items);
    riskBreakdown[key] = {
      level,
      summary: t === 0
        ? `No ${label} signals detected in current query set.`
        : `${high} high-risk and ${medium} medium-risk signals across ${t} items. ` +
          (level === 'high' || level === 'critical'
            ? `Elevated ${label} activity warrants immediate attention.`
            : level === 'medium'
            ? `Moderate ${label} signals — monitor for escalation.`
            : `${label.charAt(0).toUpperCase() + label.slice(1)} signals remain low-risk.`),
    };
  }

  const actionWindowMap = {
    critical: `Critical risk threshold exceeded — engage stakeholders, legal counsel, and regulatory liaisons within 72 hours before the public comment window narrows further.`,
    high:     `High-risk signals are active — initiate community outreach and schedule pre-application meetings with planning staff within the next 2 weeks.`,
    medium:   `Moderate risk profile — develop a community engagement plan and file preliminary regulatory inquiries within 30 days.`,
    low:      `Low risk profile — standard monitoring cadence is sufficient; revisit signals before any formal permit submission.`,
  };

  const priorityWatchItems = allItems
    .filter(i => i.risk === 'high').slice(0, 5)
    .map(i => `${i.title.slice(0, 90)}${i.title.length > 90 ? '…' : ''} (${i.source ?? i.bucket})`);
  if (priorityWatchItems.length < 3) {
    priorityWatchItems.push(
      `Monitor ${city} planning commission agenda for ${topic} items`,
      `Track public comment period openings for ${topic} permitting`,
      `Watch for neighborhood association meeting notices in ${city}`,
    );
  }

  const actionTemplates = {
    communitySentiment: `Conduct a community listening session in ${city} before the public comment period opens`,
    regulatory:         `Schedule pre-application meetings with ${city} planning and zoning staff to assess conditional use permit requirements`,
    political:          `Brief key elected officials and their staff on the ${topic} project's community and economic benefits`,
    environmental:      `Commission a preliminary environmental screening report to get ahead of CEQA/NEPA review triggers`,
    legislative:        `Track active state and local bills that could affect ${topic} permitting timelines or setback requirements`,
    grid:               `Contact the regional grid operator to request a pre-application interconnection study and confirm queue position`,
  };

  const elevated = Object.entries(riskBreakdown)
    .filter(([, v]) => v.level === 'high' || v.level === 'critical')
    .map(([k]) => k);

  const recommendedActions = elevated.length > 0
    ? elevated.slice(0, 4).map(c => actionTemplates[c])
    : [
        `Maintain current monitoring cadence and reassess before permit submission`,
        `Document current signal baseline to track escalation over time`,
        `Identify key community stakeholders in ${city} for proactive outreach`,
      ];

  return { riskScore, riskLevel, executiveSummary, oppositionLandscape, keyActors, riskBreakdown, actionWindow: actionWindowMap[riskLevel], priorityWatchItems, recommendedActions };
}

app.post('/api/brief', (req, res) => {
  const { city, topic, keywords, feeds } = req.body;
  if (!city || !topic || !feeds) return res.status(400).json({ error: 'city, topic, and feeds required' });
  const brief = computeBrief(city, topic, keywords, feeds);
  if (!brief) return res.status(422).json({ error: 'No feed items available to analyze. Run a search first.' });
  res.json(brief);
});

// ─── Advisor ──────────────────────────────────────────────────────────────────

function detectIntent(q) {
  const t = q.toLowerCase();
  if (/\b(draft|write|email|letter|outreach|message|template)\b/.test(t))                    return 'draft_email';
  if (/\b(who|meet|stakeholder|actor|contact|talk to|reach out|key people)\b/.test(t))        return 'who_to_meet';
  if (/\b(time|timing|when|deadline|urgenc|how long|how much time|window|weeks|days|soon)\b/.test(t)) return 'timing';
  if (/\b(driv|causing|why|what.s behind|reason|factor|source of)\b/.test(t))                return 'risk_drivers';
  if (/\b(what should|next step|recommend|action plan|priorit|focus|tackle|where to start)\b/.test(t)) return 'actions';
  if (/\b(oppos|resist|against|fight|who.s fighting|protest|petition)\b/.test(t))            return 'opposition';
  if (/\b(score|number|rating|how.*calculated|what does.*score|gauge|metric)\b/.test(t))      return 'score_explain';
  if (/\b(environment|wildlife|epa|ceqa|nepa|water|air|habitat)\b/.test(t))                  return 'cat_environmental';
  if (/\b(politic|elected|mayor|council|governor|senator|official|ballot)\b/.test(t))        return 'cat_political';
  if (/\b(legislat|bill|law|ordinance|congress|senate|statute)\b/.test(t))                   return 'cat_legislative';
  if (/\b(grid|ferc|interconnect|ercot|pjm|utility|transmission|queue)\b/.test(t))           return 'cat_grid';
  if (/\b(community|social|resident|neighbor|nextdoor|sentiment|public)\b/.test(t))          return 'cat_community';
  if (/\b(regulat|permit|zoning|land use|application|filing|variance)\b/.test(t))            return 'cat_regulatory';
  if (/\b(action|next step|what (should|can) (i|we)|what to do)\b/.test(t))                  return 'actions';
  return 'fallback';
}

const BREAKDOWN_LABEL = {
  communitySentiment: 'Community Sentiment', regulatory: 'Regulatory',
  political: 'Political', environmental: 'Environmental',
  legislative: 'Legislative', grid: 'Interconnection & Grid',
};

const RISK_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

function generateAdvisorResponse(question, brief, city, topic) {
  const intent = detectIntent(question);
  const {
    riskScore, riskLevel, keyActors = [], riskBreakdown = {},
    actionWindow, priorityWatchItems = [], recommendedActions = [],
    oppositionLandscape, executiveSummary,
  } = brief;
  const cityName = city.split(',')[0].trim();

  switch (intent) {
    case 'who_to_meet': {
      const opposing   = keyActors.filter(a => a.stance === 'opposing');
      const supporting = keyActors.filter(a => a.stance === 'supporting');
      const monitoring = keyActors.filter(a => a.stance === 'monitoring');
      let r = `Based on current signals for your **${topic}** project in **${cityName}**, here's who to engage and in what order:\n\n`;
      if (opposing.length) {
        r += `**⚠ Opposing — engage first**\n`;
        r += opposing.map(a => `• **${a.name}** (${a.role}) — Schedule a 1-on-1 listening session before any public hearing. Let them speak first.`).join('\n') + '\n\n';
      }
      if (monitoring.length) {
        r += `**🔍 Monitoring — build relationships now**\n`;
        r += monitoring.map(a => `• **${a.name}** (${a.role}) — Neutral. Proactive outreach could convert to support before opposition solidifies.`).join('\n') + '\n\n';
      }
      if (supporting.length) {
        r += `**✓ Supporting — activate as advocates**\n`;
        r += supporting.map(a => `• **${a.name}** (${a.role}) — Already supportive. Ask them to speak or submit written comments at public hearings.`).join('\n') + '\n\n';
      }
      r += opposing.length
        ? `**Priority:** Meet with **${opposing[0].name}** within the next 2 weeks to understand their specific concerns before they formalize opposition in writing.`
        : `**Priority:** No active opposition identified yet. Use this window to build support with monitoring stakeholders.`;
      return r;
    }

    case 'draft_email': {
      const target = keyActors.find(a => a.stance === 'opposing') ?? keyActors.find(a => a.stance === 'monitoring') ?? keyActors[0];
      const name = target?.name ?? `${cityName} Planning Commission`;
      const concerns = [
        riskBreakdown.communitySentiment?.level !== 'low' ? 'community impacts' : null,
        riskBreakdown.environmental?.level !== 'low' ? 'environmental considerations' : null,
        riskBreakdown.regulatory?.level !== 'low' ? 'regulatory compliance' : null,
      ].filter(Boolean).join(', ') || 'site design and community compatibility';
      return `Here's a draft outreach email for **${name}**:\n\n---\n\n**Subject:** ${topic} in ${cityName} — Request for Early Dialogue\n\nDear ${name} Team,\n\nWe are writing regarding our proposed **${topic}** project in ${cityName}. Before advancing to formal permitting, we are committed to engaging stakeholders early to understand local concerns and share information about our project's design and mitigation approach.\n\nWe are aware that projects of this type raise questions around ${concerns}, and we welcome the opportunity to address these directly. We would like to hear your perspective before our project enters the public comment period.\n\nWould you be available for a 30-minute introductory call in the next two weeks? We are happy to work around your schedule.\n\nThank you for your time and community leadership.\n\nSincerely,\n**[Your Name]**\n[Project Title] | [Phone] | [Email]\n\n---\n\n💡 **Tip:** Add one specific local reference — a recent council meeting or news story you saw — to show you're paying attention to their community.`;
    }

    case 'actions': {
      let r = `Here are your **top priority actions** based on the current risk profile (**${riskScore}/100, ${riskLevel}**):\n\n`;
      recommendedActions.forEach((a, i) => { r += `${i + 1}. ${a}\n`; });
      r += `\n**Why now:** ${actionWindow}`;
      return r;
    }

    case 'timing': {
      const urgency = {
        critical: `You are in the **red zone** at **${riskScore}/100**. Opposition signals are active and hardening. Every week of inaction allows groups to organize, file formal comments, and recruit political allies. Engage **within 72 hours**.`,
        high:     `You have a **narrow window — roughly 2 weeks** before current signals escalate into formal opposition. The score of ${riskScore}/100 reflects active activity across multiple channels. Start outreach immediately.`,
        medium:   `You have approximately **30 days** before signals elevate. The score of ${riskScore}/100 reflects moderate activity that hasn't yet coalesced into formal opposition. Use this window proactively.`,
        low:      `Risk signals are **contained at ${riskScore}/100**. You have time for deliberate, planned engagement rather than reactive outreach. Act before filing your permit application.`,
      }[riskLevel];
      let r = `**Action Window Assessment**\n\n${urgency}\n\n`;
      if (priorityWatchItems.length) {
        r += `**Watch these specifically — they could accelerate the timeline:**\n`;
        r += priorityWatchItems.slice(0, 3).map(w => `• ${w}`).join('\n');
      }
      return r;
    }

    case 'risk_drivers': {
      const sorted = Object.entries(riskBreakdown).sort((a, b) => (RISK_ORDER[b[1].level] ?? 0) - (RISK_ORDER[a[1].level] ?? 0));
      let r = `The **${riskScore}/100** score is driven by these factors, ranked by severity:\n\n`;
      for (const [key, val] of sorted) {
        const dot = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[val.level] ?? '⚪';
        r += `${dot} **${BREAKDOWN_LABEL[key] ?? key}** — ${val.level.toUpperCase()}\n${val.summary}\n\n`;
      }
      return r.trim();
    }

    case 'score_explain': {
      const newsSources = keyActors.filter(a => a.role === 'News Coverage').map(a => a.name).join(', ') || 'local news and community sources';
      return `**How your risk score of ${riskScore}/100 is calculated**\n\nSignals are collected from RSS feeds and Reddit, then each item is scored:\n• **High-risk (3 pts)** — contains opposition terms like "petition", "lawsuit", "moratorium", "protest"\n• **Medium-risk (1 pt)** — neutral or mixed language\n• **Low-risk (0 pts)** — contains support terms like "approved", "economic growth", "welcome"\n\nThe weighted total across all items produces the composite score. Your **${riskLevel}** rating means: ${
        { critical: 'multiple active opposition signals — immediate action required.',
          high: 'elevated opposition that needs engagement within 2 weeks.',
          medium: 'moderate signals manageable with proactive outreach.',
          low: 'few risk signals — standard monitoring is sufficient.' }[riskLevel]
      }\n\n**Active data sources:** ${newsSources}\n\n**To track movement:** click "Update Feeds" weekly and regenerate the brief. A rising score means opposition is organizing; a falling score means engagement is working.`;
    }

    case 'opposition': {
      const opp = keyActors.filter(a => a.stance === 'opposing');
      let r = `**Opposition Landscape**\n\n${oppositionLandscape}\n\n`;
      r += opp.length
        ? `**Identified opposing actors:**\n${opp.map(a => `• **${a.name}** (${a.role})`).join('\n')}\n\n`
        : `**No formally opposing actors identified yet.** Community sentiment signals suggest latent resistance that hasn't organized into named groups yet.\n\n`;
      r += `**Recommended response:** ${
        riskLevel === 'critical' || riskLevel === 'high'
          ? `Conduct a direct 1-on-1 listening session with opposing groups **before** any public hearing. Do not let their first interaction with your team be at an adversarial public meeting.`
          : `Establish regular communication with community groups now so any opposition is channeled through dialogue rather than public protest.`
      }`;
      return r;
    }

    default: {
      const catMap = {
        cat_environmental: 'environmental', cat_political: 'political',
        cat_legislative: 'legislative',     cat_grid: 'grid',
        cat_community: 'communitySentiment', cat_regulatory: 'regulatory',
      };
      const catKey = catMap[intent];
      if (catKey && riskBreakdown[catKey]) {
        const cat = riskBreakdown[catKey];
        const label = BREAKDOWN_LABEL[catKey];
        const relatedAction = recommendedActions.find(a => a.toLowerCase().includes(catKey.replace('cat_', ''))) ?? recommendedActions[0];
        const relatedWatch = priorityWatchItems.slice(0, 2);
        let r = `**${label} Risk — ${cat.level.toUpperCase()}**\n\n${cat.summary}\n\n`;
        if (relatedWatch.length) r += `**Watch items:**\n${relatedWatch.map(w => `• ${w}`).join('\n')}\n\n`;
        if (relatedAction) r += `**Suggested action:** ${relatedAction}`;
        return r;
      }
      return `I can answer questions about this brief. Try asking:\n\n• **"Who should I meet with first?"**\n• **"What's driving the risk score?"**\n• **"How much time do I have?"**\n• **"Who's opposing this project?"**\n• **"What should I do next?"**\n• **"Tell me about the environmental risk"**\n• **"Draft a stakeholder outreach email"**\n\nOr ask anything about the project in your own words.`;
    }
  }
}

app.post('/api/advisor', (req, res) => {
  const { question, brief, city, topic } = req.body;
  if (!question || !brief) return res.status(400).json({ error: 'question and brief required' });
  const response = generateAdvisorResponse(question.trim(), brief, city, topic);
  res.json({ response, intent: detectIntent(question) });
});

module.exports = app;
