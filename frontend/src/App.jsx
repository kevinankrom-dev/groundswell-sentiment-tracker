import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  History, Users, FileText, Landmark, Newspaper, Settings,
  Search, Clock, ShieldAlert, ExternalLink, AlertCircle, ChevronDown, ChevronUp,
  Leaf, Zap, Scale, Building2, Brain, X, TrendingUp, MessageSquare, Send, Sparkles,
} from 'lucide-react';

// ─── Query library (mirrors backend QUERY_TEMPLATES) ─────────────────────────

const QUERY_LIBRARY = [
  {
    widget: 'meetings',
    label: 'Meeting Minutes & Transcripts',
    color: 'teal',
    queries: [
      { id: 'meetings_council', label: 'Council & Commission Meetings',  default: true  },
      { id: 'meetings_staff',   label: 'Staff Reports & Agenda Items',   default: false },
      { id: 'meetings_board',   label: 'Board of Supervisors / County',  default: false },
    ],
  },
  {
    widget: 'social',
    label: 'Social Media Summary',
    color: 'violet',
    queries: [
      { id: 'social_opposition', label: 'Community Opposition & Petitions', default: true  },
      { id: 'social_nextdoor',   label: 'NextDoor & Facebook Groups',       default: false },
      { id: 'social_rally',      label: 'Rallies & Demonstrations',         default: false },
    ],
  },
  {
    widget: 'applications',
    label: 'Permit & Application Insights',
    color: 'amber',
    queries: [
      { id: 'apps_permits', label: 'Permits & Variances',              default: true  },
      { id: 'apps_env',     label: 'Environmental Impact Reports',     default: true  },
      { id: 'apps_ferc',    label: 'FERC / Utility Commission Filings',default: false },
    ],
  },
  {
    widget: 'townhalls',
    label: 'Townhalls & Public Hearings',
    color: 'sky',
    queries: [
      { id: 'townhalls_general', label: 'Public Comment & Town Halls',    default: true  },
      { id: 'townhalls_notice',  label: 'Public Notices & Scoping',       default: false },
      { id: 'townhalls_hearing', label: 'Formal Commission Hearings',     default: false },
    ],
  },
  {
    widget: 'news',
    label: 'Local News Analysis',
    color: 'rose',
    queries: [
      { id: 'news_general',       label: 'General News Coverage',    default: true  },
      { id: 'news_editorial',     label: 'Editorials & Opinion',     default: false },
      { id: 'news_investigative', label: 'Investigative Reports',    default: false },
    ],
  },
  {
    widget: 'zoning',
    label: 'Zoning & Land Use Barriers',
    color: 'orange',
    queries: [
      { id: 'zoning_general',    label: 'Zoning & Land Use Changes',      default: true  },
      { id: 'zoning_moratorium', label: 'Moratoriums & Development Holds', default: false },
      { id: 'zoning_code',       label: 'Municipal Code Amendments',      default: false },
    ],
  },
  {
    widget: 'environmental',
    label: 'Environmental',
    color: 'green',
    queries: [
      { id: 'env_impact',   label: 'CEQA / NEPA / EIR Impact Reports', default: true  },
      { id: 'env_wildlife', label: 'Wildlife, Wetlands & Conservation', default: false },
      { id: 'env_epa',      label: 'EPA & Clean Air / Water Act',       default: false },
    ],
  },
  {
    widget: 'political',
    label: 'Political Activity',
    color: 'indigo',
    queries: [
      { id: 'political_officials', label: 'Elected Officials & Statements', default: true  },
      { id: 'political_campaign',  label: 'Ballot Measures & Executive Orders', default: false },
      { id: 'political_lobby',     label: 'Lobbying & Advocacy Groups',    default: false },
    ],
  },
  {
    widget: 'legislative',
    label: 'Legislative Activity',
    color: 'cyan',
    queries: [
      { id: 'legislative_state',   label: 'State Bills & Ordinances',      default: true  },
      { id: 'legislative_federal', label: 'Federal Legislation & Grants',  default: false },
      { id: 'legislative_local',   label: 'City & County Resolutions',     default: false },
    ],
  },
  {
    widget: 'grid',
    label: 'Interconnection & Grid',
    color: 'yellow',
    queries: [
      { id: 'grid_ferc',     label: 'FERC & Utility Commission Filings', default: true  },
      { id: 'grid_operator', label: 'Grid Operators (ERCOT, PJM, MISO)', default: false },
      { id: 'grid_queue',    label: 'Interconnection Queue & Delays',    default: false },
    ],
  },
];

const ALL_QUERIES   = QUERY_LIBRARY.flatMap(g => g.queries);
const DEFAULT_IDS   = new Set(ALL_QUERIES.filter(q => q.default).map(q => q.id));

function buildRssUrl(queryStr) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(queryStr)}&hl=en-US&gl=US&ceid=US:en`;
}

function buildQueryString(id, city, topic, keywords) {
  const kwList = keywords.split(',').map(k => k.trim()).filter(Boolean);
  const kwOr   = kwList.length ? ` (${kwList.map(k => `"${k}"`).join(' OR ')})` : '';
  const base   = `"${topic}" "${city}"`;

  const templates = {
    meetings_council:    () => `${base} ("council meeting" OR "planning commission" OR "public hearing" OR "meeting minutes")`,
    meetings_staff:      () => `${base} ("staff report" OR "agenda item" OR "docket" OR "resolution")`,
    meetings_board:      () => `${base} ("board of supervisors" OR "county commission" OR "city council vote")`,
    social_opposition:   () => `${base} (petition OR "community opposition" OR "residents oppose" OR "public backlash" OR protest OR "NextDoor" OR "Facebook group")`,
    social_nextdoor:     () => `${base} (NextDoor OR "neighborhood association" OR "Facebook group" OR "community group")`,
    social_rally:        () => `${base} (rally OR demonstration OR "citizens against" OR "community fight" OR "residents rally")`,
    apps_permits:        () => `${base} (permit OR variance OR "permit application" OR "conditional use" OR "special use permit")`,
    apps_env:            () => `${base} ("environmental impact" OR EIR OR EIS OR CEQA OR NEPA OR "environmental review")`,
    apps_ferc:           () => `${base} (FERC OR "utility commission" OR PUC OR "interconnection" OR "grid connection" OR "rate case")`,
    townhalls_general:   () => `${base} ("town hall" OR townhall OR "community meeting" OR "public comment" OR "comment period")`,
    townhalls_notice:    () => `${base} ("public notice" OR "scoping meeting" OR "notice of preparation" OR "notice of intent")`,
    townhalls_hearing:   () => `${base} ("commission hearing" OR "board hearing" OR "administrative hearing" OR "public session")`,
    news_general:        () => `${base}${kwOr}`,
    news_editorial:      () => `${base} (editorial OR opinion OR "letter to the editor" OR commentary)`,
    news_investigative:  () => `${base} (investigative OR "special report" OR "exclusive")`,
    zoning_general:      () => `${base} (zoning OR "land use" OR rezoning OR setback OR "overlay district")`,
    zoning_moratorium:   () => `${base} (moratorium OR "development hold" OR "temporary ban" OR "pause" OR "freeze")`,
    zoning_code:         () => `${base} ("zoning ordinance" OR "municipal code" OR "development standards" OR "code amendment")`,
    env_impact:          () => `${base} ("environmental impact" OR EIR OR EIS OR CEQA OR NEPA OR "air quality" OR "water quality" OR stormwater)`,
    env_wildlife:        () => `${base} ("endangered species" OR wetlands OR habitat OR wildlife OR conservation OR "Sierra Club" OR "environmental group")`,
    env_epa:             () => `${base} (EPA OR "Clean Air Act" OR "Clean Water Act" OR "hazardous materials" OR toxic OR remediation)`,
    political_officials: () => `${base} (senator OR congressman OR "city council" OR mayor OR governor OR "elected official" OR "state representative")`,
    political_campaign:  () => `${base} ("ballot measure" OR referendum OR "executive order" OR "signed into law" OR veto OR "campaign contribution")`,
    political_lobby:     () => `${base} (lobbying OR "political opposition" OR "advocacy group" OR PAC OR "special interest")`,
    legislative_state:   () => `${base} ("state bill" OR "senate bill" OR "house bill" OR ordinance OR "state legislature")`,
    legislative_federal: () => `${base} (congress OR "federal legislation" OR IRA OR "infrastructure law" OR "federal grant" OR DOE OR "permitting reform")`,
    legislative_local:   () => `${base} ("city ordinance" OR "county ordinance" OR "local law" OR "municipal resolution")`,
    grid_ferc:           () => `${base} (FERC OR interconnection OR "grid connection" OR transmission OR "utility commission" OR "rate case")`,
    grid_operator:       () => `${base} (PUC OR "public utility" OR ISO OR RTO OR ERCOT OR PJM OR MISO OR CAISO OR "grid operator")`,
    grid_queue:          () => `${base} ("interconnection queue" OR curtailment OR "grid upgrade" OR substation OR "capacity constraint" OR "queue delay")`,
  };
  return templates[id]?.() ?? '';
}

// ─── Keyword presets ─────────────────────────────────────────────────────────

const KEYWORD_PRESETS = {
  'Data Center': [
    'Water Usage', 'Power Consumption', 'Noise', 'Traffic', 'Visual Impact',
    'Heat Island', 'Cooling Tower', 'Grid Connection', 'Groundwater', 'Setback',
    'Zoning', 'Moratorium', 'Overlay District', 'Land Use',
  ],
  'Solar Farm': [
    'Glare', 'Habitat', 'Wildlife', 'Agricultural Land', 'Stormwater',
    'Visual Impact', 'Decommissioning', 'Setback', 'Shadow Flicker', 'Land Use',
    'Zoning', 'Moratorium', 'Special Use Permit', 'Property Values',
  ],
  'Wind Project': [
    'Noise', 'Shadow Flicker', 'Wildlife', 'Avian Impact', 'Visual Impact',
    'Setback', 'FAA', 'Radar Interference', 'Turbine Height', 'Land Use',
    'Zoning', 'Moratorium', 'Property Values', 'Ice Throw',
  ],
  'Battery Storage': [
    'Fire Risk', 'Safety', 'Hazmat', 'Thermal Runaway', 'Noise',
    'Land Use', 'Setback', 'Environmental Impact', 'Zoning', 'Moratorium',
    'Property Values', 'Emergency Response', 'Chemical Storage',
  ],
  'Transmission Line': [
    'Right of Way', 'EMF', 'Visual Impact', 'Property Values',
    'Easement', 'Routing', 'Vegetation Management', 'Land Use',
    'Zoning', 'Moratorium', 'Setback', 'Underground', 'Tree Removal',
  ],
};

const GENERAL_KEYWORDS = [
  'Opposition', 'Community Concern', 'Petition', 'Protest', 'NIMBY',
  'Lawsuit', 'Appeal', 'Moratorium', 'Permit Denial', 'Public Hearing',
  'Environmental Review', 'Public Comment', 'Rezoning', 'Variance Denial',
];

// ─── KeywordSelector component ────────────────────────────────────────────────

const KeywordSelector = ({ value, onChange, topic }) => {
  const [inputVal, setInputVal] = useState('');
  const [open, setOpen]         = useState(false);
  const inputRef                = useRef(null);
  const containerRef            = useRef(null);

  const tags    = value.split(',').map(s => s.trim()).filter(Boolean);
  const setTags = (next) => onChange(next.join(', '));

  const addTag = (raw) => {
    const tag = raw.trim().replace(/,$/, '');
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setInputVal('');
  };

  const removeTag = (tag) => setTags(tags.filter(t => t !== tag));

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) {
      e.preventDefault();
      addTag(inputVal);
    }
    if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const topicSuggestions   = (KEYWORD_PRESETS[topic] ?? []).filter(s => !tags.includes(s) && s.toLowerCase().includes(inputVal.toLowerCase()));
  const generalSuggestions = GENERAL_KEYWORDS.filter(s => !tags.includes(s) && s.toLowerCase().includes(inputVal.toLowerCase()));
  const hasDropdown        = open && (topicSuggestions.length > 0 || generalSuggestions.length > 0);

  return (
    <div ref={containerRef} className="relative">
      {/* Tag input box */}
      <div
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
        className="min-h-[42px] bg-[#151923] border border-slate-700 rounded-lg px-3 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 transition-all"
      >
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-1 bg-teal-900/40 text-teal-300 text-xs px-2 py-0.5 rounded-full border border-teal-700/40 select-none">
            {tag}
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); removeTag(tag); }}
              className="text-teal-500 hover:text-white transition-colors leading-none text-sm"
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={tags.length === 0 ? 'Type or select keywords…' : ''}
          className="flex-1 min-w-[100px] bg-transparent text-white text-sm outline-none placeholder-slate-600 py-0.5"
        />
      </div>

      {/* Dropdown */}
      {hasDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-[#1e2330] border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
          {topicSuggestions.length > 0 && (
            <>
              <div className="px-3 pt-2.5 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-[#1e2330]">
                {topic}
              </div>
              {topicSuggestions.map(s => (
                <button key={s} type="button" onMouseDown={() => addTag(s)}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-teal-900/30 hover:text-teal-300 transition-colors">
                  {s}
                </button>
              ))}
            </>
          )}
          {generalSuggestions.length > 0 && (
            <>
              <div className={`px-3 pt-2.5 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-[#1e2330] ${topicSuggestions.length > 0 ? 'border-t border-slate-700/50 mt-1' : ''}`}>
                General Risk Terms
              </div>
              {generalSuggestions.map(s => (
                <button key={s} type="button" onMouseDown={() => addTag(s)}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-teal-900/30 hover:text-teal-300 transition-colors">
                  {s}
                </button>
              ))}
            </>
          )}
          <div className="h-1.5" />
        </div>
      )}
    </div>
  );
};

const COLOR_RING = {
  teal:   'ring-teal-500/40',   violet: 'ring-violet-500/40', amber:  'ring-amber-500/40',
  sky:    'ring-sky-500/40',    rose:   'ring-rose-500/40',   orange: 'ring-orange-500/40',
  green:  'ring-green-500/40',  indigo: 'ring-indigo-500/40', cyan:   'ring-cyan-500/40',
  yellow: 'ring-yellow-500/40',
};
const COLOR_DOT = {
  teal:   'bg-teal-500',   violet: 'bg-violet-500', amber:  'bg-amber-500',
  sky:    'bg-sky-500',    rose:   'bg-rose-500',   orange: 'bg-orange-500',
  green:  'bg-green-500',  indigo: 'bg-indigo-500', cyan:   'bg-cyan-500',
  yellow: 'bg-yellow-500',
};
const COLOR_CHECK = {
  teal:   'accent-teal-500',   violet: 'accent-violet-500', amber:  'accent-amber-500',
  sky:    'accent-sky-500',    rose:   'accent-rose-500',   orange: 'accent-orange-500',
  green:  'accent-green-500',  indigo: 'accent-indigo-500', cyan:   'accent-cyan-500',
  yellow: 'accent-yellow-500',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const RiskBadge = ({ risk }) => {
  const styles = {
    high:   'bg-red-900/50 text-red-400 border-red-700/50',
    medium: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
    low:    'bg-emerald-900/50 text-emerald-400 border-emerald-700/50',
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full border ${styles[risk] ?? styles.medium} capitalize font-medium`}>
      {risk} Risk
    </span>
  );
};

const ItemCard = ({ item }) => (
  <a href={item.link} target="_blank" rel="noopener noreferrer"
    className="block bg-[#151923] p-3 rounded-lg border border-slate-700/50 hover:border-teal-500/30 transition-colors group">
    <h4 className="text-sm font-medium text-slate-200 group-hover:text-teal-400 mb-1 line-clamp-2">{item.title}</h4>
    {item.snippet && <p className="text-xs text-slate-500 mb-2 line-clamp-2">{item.snippet}</p>}
    <div className="flex items-center justify-between mt-2 gap-2">
      <span className="text-xs text-slate-500 flex items-center gap-1 truncate">
        <Clock size={11} className="flex-shrink-0" />{item.date}
        {item.source && <span className="ml-1 text-slate-600 truncate">· {item.source}</span>}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <RiskBadge risk={item.risk} />
        <ExternalLink size={11} className="text-slate-600 group-hover:text-teal-500" />
      </div>
    </div>
  </a>
);

const SkeletonCard = () => (
  <div className="animate-pulse bg-[#151923] p-3 rounded-lg border border-slate-700/50 space-y-2">
    <div className="h-4 bg-slate-700/40 rounded w-full" />
    <div className="h-4 bg-slate-700/40 rounded w-4/5" />
    <div className="h-3 bg-slate-700/30 rounded w-1/3 mt-3" />
  </div>
);

// ─── Risk gauge SVG ───────────────────────────────────────────────────────────

const RISK_COLORS = {
  critical: { stroke: '#ef4444', text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700/40'    },
  high:     { stroke: '#f97316', text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700/40' },
  medium:   { stroke: '#f59e0b', text: 'text-amber-400',  bg: 'bg-amber-900/30',  border: 'border-amber-700/40'  },
  low:      { stroke: '#22c55e', text: 'text-emerald-400',bg: 'bg-emerald-900/30',border: 'border-emerald-700/40'},
};

const RiskGauge = ({ score, level }) => {
  const r = 52;
  const cx = 64, cy = 64;
  const circumference = Math.PI * r; // half-circle arc
  const pct = Math.min(Math.max(score, 0), 100) / 100;
  const offset = circumference * (1 - pct);
  const colors = RISK_COLORS[level] ?? RISK_COLORS.medium;

  return (
    <div className="flex flex-col items-center">
      <svg width="130" height="76" viewBox="0 0 128 76">
        {/* Track */}
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none" stroke="#1e2d3d" strokeWidth="12" strokeLinecap="round" />
        {/* Fill */}
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none" stroke={colors.stroke} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="-mt-4 text-center">
        <div className={`text-4xl font-bold ${colors.text}`}>{score}</div>
        <div className={`text-xs font-semibold uppercase tracking-widest mt-0.5 ${colors.text}`}>{level} Risk</div>
      </div>
    </div>
  );
};

// ─── Category level badge ─────────────────────────────────────────────────────

const LevelBadge = ({ level }) => {
  const styles = {
    critical: 'bg-red-900/40 text-red-400 border-red-700/40',
    high:     'bg-orange-900/40 text-orange-400 border-orange-700/40',
    medium:   'bg-amber-900/40 text-amber-400 border-amber-700/40',
    low:      'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize flex-shrink-0 ${styles[level] ?? styles.medium}`}>
      {level}
    </span>
  );
};

// ─── Intelligence Brief Modal ─────────────────────────────────────────────────

const BREAKDOWN_LABELS = {
  communitySentiment: 'Community Sentiment',
  regulatory:         'Regulatory',
  political:          'Political',
  environmental:      'Environmental',
  legislative:        'Legislative',
  grid:               'Interconnection & Grid',
};

const BriefModal = ({ brief, onClose }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4 py-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl bg-[#0f1219] border border-slate-700/60 rounded-2xl shadow-2xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2.5">
            <Brain size={20} className="text-teal-400" />
            <span className="text-white font-semibold">AI Intelligence Brief</span>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/40 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Risk score gauge */}
          <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50 flex flex-col sm:flex-row items-center gap-6">
            <RiskGauge score={brief.riskScore} level={brief.riskLevel} />
            <div className="flex-1">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Executive Summary</h3>
              <p className="text-slate-300 text-sm leading-relaxed">{brief.executiveSummary}</p>
            </div>
          </div>

          {/* Opposition landscape */}
          <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <TrendingUp size={13} className="text-slate-500" /> Opposition Landscape
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed">{brief.oppositionLandscape}</p>
          </div>

          {/* Risk breakdown */}
          <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Risk Breakdown</h3>
            <div className="space-y-3">
              {Object.entries(brief.riskBreakdown ?? {}).map(([key, val]) => (
                <div key={key} className="flex items-start gap-3">
                  <div className="w-40 flex-shrink-0 flex items-center gap-2 pt-0.5">
                    <LevelBadge level={val.level} />
                    <span className="text-xs text-slate-400 truncate">{BREAKDOWN_LABELS[key] ?? key}</span>
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">{val.summary}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Two-column: Key actors + Action window */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Key Actors</h3>
              <ul className="space-y-2">
                {(brief.keyActors ?? []).map((actor, i) => {
                  const isObj = typeof actor === 'object' && actor !== null;
                  const name  = isObj ? actor.name  : actor;
                  const role  = isObj ? actor.role  : null;
                  const stance = isObj ? actor.stance : null;
                  const stanceStyle = {
                    opposing:   'bg-red-900/40 text-red-400 border-red-700/40',
                    supporting: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
                    monitoring: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
                  }[stance] ?? 'bg-slate-700/40 text-slate-400 border-slate-600/40';
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-slate-200 truncate">{name}</span>
                        {role && <span className="text-xs text-slate-500">{role}</span>}
                      </div>
                      {stance && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 capitalize ${stanceStyle}`}>
                          {stance}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Action Window</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{brief.actionWindow}</p>
              </div>
            </div>
          </div>

          {/* Priority watch + Recommended actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Priority Watch Items</h3>
              <ul className="space-y-1.5">
                {(brief.priorityWatchItems ?? []).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-amber-500 mt-0.5">▲</span>{item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-[#1e2330] rounded-xl p-5 border border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recommended Actions</h3>
              <ul className="space-y-1.5">
                {(brief.recommendedActions ?? []).map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-teal-500 mt-0.5">→</span>{action}
                  </li>
                ))}
              </ul>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ─── Advisor message renderer ─────────────────────────────────────────────────

function renderAdvisorText(text) {
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith('---')) {
      elements.push(<hr key={key++} className="border-slate-700/50 my-3" />);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-2" />);
    } else if (line.startsWith('• ')) {
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-slate-300 leading-relaxed">
          <span className="text-violet-400 mt-0.5 flex-shrink-0">•</span>
          <span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>') }} />
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const [num, ...rest] = line.split(/\.\s(.+)/);
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-slate-300 leading-relaxed">
          <span className="text-violet-400 font-mono flex-shrink-0 w-4">{num}.</span>
          <span dangerouslySetInnerHTML={{ __html: rest[0]?.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>') ?? '' }} />
        </div>
      );
    } else {
      elements.push(
        <p key={key++} className="text-sm text-slate-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/💡\s*\*\*(.+?)\*\*/, '💡 <strong class="text-amber-300">$1</strong>') }} />
      );
    }
  }
  return elements;
}

// ─── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'Who should I meet with first?',
  'What\'s driving the risk score?',
  'How much time do I have?',
  'Who\'s opposing this project?',
  'What should I do next?',
  'Draft a stakeholder outreach email',
  'Tell me about the environmental risk',
  'Explain the risk score',
];

// ─── Advisor Panel ────────────────────────────────────────────────────────────

const AdvisorPanel = ({ brief, briefLoading, city, topic, onClose }) => {
  const [messages, setMessages]     = useState([{
    role: 'advisor',
    content: `Hi! I'm your Risk Advisor for the **${topic}** project in **${city.split(',')[0]}**.${briefLoading ? '\n\nAnalyzing your feeds — I\'ll be ready to answer questions in a moment…' : brief ? `\n\nRisk score: **${brief.riskScore}/100 (${brief.riskLevel})**.\n\nAsk me anything about the risk landscape, who to engage, timing, or click a suggested question below.` : '\n\nClick **Generate Brief** to analyze your feeds, then ask me anything about the risk landscape, who to engage, timing, and more.'}`,
  }]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const bottomRef                   = useRef(null);
  const inputRef                    = useRef(null);

  // When brief finishes loading, add a ready message
  const prevBriefRef = useRef(brief);
  useEffect(() => {
    if (!prevBriefRef.current && brief) {
      setMessages(prev => [...prev, {
        role: 'advisor',
        content: `Analysis complete! Risk score: **${brief.riskScore}/100 (${brief.riskLevel})**.\n\nAsk me anything about the risk landscape, who to engage, timing, or click a suggested question below.`,
      }]);
    }
    prevBriefRef.current = brief;
  }, [brief]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ask = async (question) => {
    if (!question.trim() || loading || !brief) return;
    const q = question.trim();
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, brief, city, topic }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Advisor error');
      setMessages(prev => [...prev, { role: 'advisor', content: json.response }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'advisor', content: `Sorry, something went wrong: ${e.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask(input);
  };

  // Filter out already-asked questions from suggestions
  const askedSet = new Set(messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase()));
  const suggestions = SUGGESTED_QUESTIONS.filter(q => !askedSet.has(q.toLowerCase())).slice(0, 4);

  return (
    <div className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-md flex flex-col bg-[#0f1219] border-l border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-violet-900/50 flex items-center justify-center">
            <Sparkles size={15} className="text-violet-400" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm">Risk Advisor</div>
            <div className="text-xs text-slate-500">{topic} · {city.split(',')[0]}</div>
          </div>
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/40 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'advisor' && (
              <div className="w-7 h-7 rounded-full bg-violet-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles size={12} className="text-violet-400" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 space-y-1 ${
              msg.role === 'user'
                ? 'bg-violet-700/30 border border-violet-600/30 text-white text-sm rounded-tr-sm'
                : 'bg-[#1e2330] border border-slate-700/50 rounded-tl-sm'
            }`}>
              {msg.role === 'user'
                ? <p className="text-sm text-white">{msg.content}</p>
                : renderAdvisorText(msg.content)
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <Sparkles size={12} className="text-violet-400" />
            </div>
            <div className="bg-[#1e2330] border border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions */}
      {suggestions.length > 0 && brief && (
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={loading}
                className="text-xs px-3 py-1.5 bg-slate-800/60 hover:bg-violet-900/30 border border-slate-700/50 hover:border-violet-600/40 text-slate-400 hover:text-violet-300 rounded-full transition-colors disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit}
        className="px-4 pb-4 pt-2 border-t border-slate-700/50 flex-shrink-0">
        <div className={`flex gap-2 items-center bg-[#1e2330] border rounded-xl px-3 py-2 transition-all ${brief ? 'border-slate-700 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500/40' : 'border-slate-700/40 opacity-50'}`}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={briefLoading ? 'Analyzing feeds, please wait…' : brief ? 'Ask about risks, actors, timing…' : 'Generate a brief first to ask questions…'}
            disabled={loading || !brief}
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder-slate-600"
          />
          <button type="submit" disabled={!input.trim() || loading || !brief}
            className="p-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0">
            <Send size={13} />
          </button>
        </div>
      </form>
    </div>
  );
};

const WidgetCard = ({ title, icon: Icon, description, items, loading, collapsed, onToggleCollapse }) => (
  <div className="bg-[#1e2330] rounded-xl p-6 border border-slate-700/50 shadow-lg">
    {/* Header — always visible */}
    <div className="flex flex-col items-center mb-4 text-center relative">
      <button
        onClick={onToggleCollapse}
        className="absolute top-0 right-0 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700/40 transition-colors"
        title={collapsed ? 'Expand feed' : 'Collapse feed'}
      >
        {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      <div className="w-12 h-12 rounded-full bg-[#366368] flex items-center justify-center mb-4 text-[#8bd3d6]">
        <Icon size={24} />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-400">{description}</p>
    </div>

    {/* Feed items — collapsible */}
    {!collapsed && (
      <div className="space-y-3">
        {loading ? (
          <><SkeletonCard /><SkeletonCard /></>
        ) : items?.length > 0 ? (
          items.map(item => <ItemCard key={item.id} item={item} />)
        ) : (
          <div className="flex items-center gap-2 text-slate-500 text-sm p-3 bg-[#151923] rounded-lg border border-slate-700/50">
            <AlertCircle size={15} className="flex-shrink-0" />
            No results found for this query.
          </div>
        )}
      </div>
    )}
  </div>
);

const WIDGETS = [
  { key: 'meetings',      title: 'Meeting Minutes & Transcripts', icon: History,   description: 'Recent mentions in local government meeting records.' },
  { key: 'social',        title: 'Social Media Summary',          icon: Users,     description: 'Community sentiment via Reddit and public forums.' },
  { key: 'applications',  title: 'Permit & Application Insights', icon: FileText,  description: 'Similar project filings and regulatory submissions.' },
  { key: 'townhalls',     title: 'Townhalls & Public Hearings',   icon: Landmark,  description: 'Civic engagements where your project may be discussed.' },
  { key: 'news',          title: 'Local News Analysis',           icon: Newspaper, description: 'RSS aggregation from local and regional publications.' },
  { key: 'zoning',        title: 'Zoning & Land Use Barriers',    icon: Settings,  description: 'Regulatory changes or docket updates impacting viability.' },
  { key: 'environmental', title: 'Environmental Signals',         icon: Leaf,      description: 'CEQA / NEPA filings, EPA actions, and environmental group activity.' },
  { key: 'political',     title: 'Political Activity',            icon: Building2, description: 'Elected officials, lobbying, ballot measures, and executive actions.' },
  { key: 'legislative',   title: 'Legislative Activity',          icon: Scale,     description: 'State bills, federal legislation, and local ordinances.' },
  { key: 'grid',          title: 'Interconnection & Grid',        icon: Zap,       description: 'FERC filings, utility commission dockets, and grid queue status.' },
];

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function App() {
  const [city,            setCity]            = useState('Austin');
  const [topic,           setTopic]           = useState('Data Center');
  const [keywords,        setKeywords]        = useState('Zoning, Water Usage, Noise');
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [data,            setData]            = useState(null);
  const [selectedQueries,  setSelectedQueries]  = useState(new Set(DEFAULT_IDS));
  const [showConfig,       setShowConfig]       = useState(false);
  const [collapsedWidgets, setCollapsedWidgets] = useState(new Set());
  const [brief,            setBrief]            = useState(null);
  const [briefLoading,     setBriefLoading]     = useState(false);
  const [briefError,       setBriefError]       = useState(null);
  const [showAdvisor,      setShowAdvisor]      = useState(false);
  const [showBriefModal,   setShowBriefModal]   = useState(false);

  const toggleCollapse = (key) => setCollapsedWidgets(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const fetchData = useCallback(async (c, t, kw, qIds) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        city: c, topic: t, keywords: kw,
        queries: [...qIds].join(','),
      });
      const res = await fetch(`/api/feeds?${params}`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchData(city, topic, keywords, selectedQueries);
  };

  useEffect(() => {
    fetchData('Austin', 'Data Center', 'Zoning, Water Usage, Noise', DEFAULT_IDS);
  }, [fetchData]);

  const toggleQuery = (id) => {
    setSelectedQueries(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const resetDefaults = () => setSelectedQueries(new Set(DEFAULT_IDS));

  const generateBrief = async (showModal = false) => {
    if (!data) return;
    if (brief) { if (showModal) setShowBriefModal(true); return; }
    setBriefLoading(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, topic, keywords, feeds: data }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `API returned ${res.status}`);
      setBrief(json);
      if (showModal) setShowBriefModal(true);
    } catch (err) {
      setBriefError(err.message);
    } finally {
      setBriefLoading(false);
    }
  };

  // Build active query rows for the URL display
  const activeQueryRows = ALL_QUERIES
    .filter(q => selectedQueries.has(q.id))
    .map(q => ({
      ...q,
      url: buildRssUrl(buildQueryString(q.id, city, topic, keywords)),
      group: QUERY_LIBRARY.find(g => g.queries.some(x => x.id === q.id)),
    }));

  return (
    <div className={`min-h-screen bg-[#0f1219] text-slate-300 p-6 font-sans transition-all duration-300 ${showAdvisor && brief ? 'pr-[420px]' : ''}`}>
      <div className="max-w-7xl mx-auto space-y-8">

        {/* ── Header & Controls ── */}
        <div className="bg-[#1e2330] rounded-2xl p-6 border border-slate-700/50 shadow-xl">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <ShieldAlert className="text-teal-500" />
                Groundswell Sentiment Tracker
              </h1>
              <p className="text-slate-400 text-sm mt-1">Real-time RSS aggregation &amp; sentiment analysis</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-3 py-1.5 bg-teal-900/30 text-teal-400 border border-teal-800/50 rounded-lg text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                Live Monitoring
              </div>
              {data && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => brief ? setShowBriefModal(true) : generateBrief(true)}
                    disabled={briefLoading}
                    className="flex items-center gap-2 px-4 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg"
                  >
                    {briefLoading
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Brain size={16} />}
                    {briefLoading ? 'Generating…' : brief ? 'Show Brief Intelligence' : 'Generate Brief'}
                  </button>
                  <button
                    onClick={() => { setShowAdvisor(v => !v); if (!brief && !briefLoading) generateBrief(false); }}
                    className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors shadow-lg border ${
                      showAdvisor
                        ? 'bg-violet-900/40 border-violet-600/50 text-violet-300'
                        : 'bg-[#1e2330] border-slate-700 text-slate-300 hover:border-violet-600/50 hover:text-violet-300'
                    }`}
                  >
                    <MessageSquare size={16} />
                    {showAdvisor ? 'Hide AI' : 'Ask AI'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Target City / Region</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Austin, TX"
                className="w-full bg-[#151923] border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Project Type</label>
              <select value={topic} onChange={e => setTopic(e.target.value)}
                className="w-full bg-[#151923] border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-teal-500 transition-all">
                <option value="Data Center">Data Center</option>
                <option value="Solar Farm">Solar Farm</option>
                <option value="Wind Project">Wind Project</option>
                <option value="Battery Storage">Battery Storage</option>
                <option value="Transmission Line">Transmission Line</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Risk Keywords</label>
              <KeywordSelector value={keywords} onChange={setKeywords} topic={topic} />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors">
                {loading
                  ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Search size={18} />}
                Update Feeds
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
              <AlertCircle size={15} className="flex-shrink-0" />
              {error} — make sure the backend is running (<code className="font-mono text-xs">npm run dev</code> from project root).
            </div>
          )}

          {briefError && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-700/30 rounded-lg text-red-400 text-sm flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="flex-shrink-0" />
                Brief error: {briefError}
              </div>
              <button onClick={() => setBriefError(null)} className="text-red-500 hover:text-red-300 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          {/* ── Configure Queries toggle ── */}
          <div className="mt-6 pt-4 border-t border-slate-700/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Active RSS Queries
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-900/40 text-teal-400 border border-teal-800/40">
                  {selectedQueries.size} selected
                </span>
              </div>
              <button onClick={() => setShowConfig(v => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-400 transition-colors">
                {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showConfig ? 'Hide' : 'Configure'} Query Library
              </button>
            </div>

            {/* ── Query Library panel ── */}
            {showConfig && (
              <div className="mb-4 bg-[#151923] rounded-xl border border-slate-700/50 p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {QUERY_LIBRARY.map(group => (
                    <div key={group.widget}
                      className={`bg-[#1e2330] rounded-lg p-4 ring-1 ${COLOR_RING[group.color]}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`w-2 h-2 rounded-full ${COLOR_DOT[group.color]}`} />
                        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                          {group.label}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {group.queries.map(q => (
                          <label key={q.id}
                            className="flex items-center gap-2.5 cursor-pointer group/row">
                            <input
                              type="checkbox"
                              checked={selectedQueries.has(q.id)}
                              onChange={() => toggleQuery(q.id)}
                              className={`w-3.5 h-3.5 rounded ${COLOR_CHECK[group.color]} bg-slate-700 border-slate-600`}
                            />
                            <span className="text-xs text-slate-400 group-hover/row:text-slate-200 transition-colors">
                              {q.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4 pt-3 border-t border-slate-700/50">
                  <button onClick={resetDefaults}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}

            {/* ── Active query URL list ── */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {activeQueryRows.map(q => (
                <div key={q.id} className="flex items-center gap-2 bg-[#151923] px-3 py-2 rounded-lg border border-slate-700/40 group">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${COLOR_DOT[q.group?.color ?? 'teal']}`} />
                  <span className="text-xs text-slate-400 w-44 flex-shrink-0 truncate">{q.label}</span>
                  <span className="text-xs font-mono text-slate-600 truncate flex-1 min-w-0">{q.url}</span>
                  <a href={q.url} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 text-slate-600 hover:text-teal-400 transition-colors">
                    <ExternalLink size={12} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Dashboard Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {WIDGETS.map(w => (
            <WidgetCard key={w.key} title={w.title} icon={w.icon}
              description={w.description} items={data?.[w.key]} loading={loading}
              collapsed={collapsedWidgets.has(w.key)}
              onToggleCollapse={() => toggleCollapse(w.key)} />
          ))}
        </div>

      </div>

      {/* ── Intelligence Brief Modal ── */}
      {brief && showBriefModal && <BriefModal brief={brief} onClose={() => setShowBriefModal(false)} />}

      {/* ── Advisor Panel ── */}
      {showAdvisor && (
        <AdvisorPanel
          brief={brief}
          briefLoading={briefLoading}
          city={city}
          topic={topic}
          onClose={() => setShowAdvisor(false)}
        />
      )}
    </div>
  );
}
