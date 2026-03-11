// ════════════════════════════════════════════════════════════════
//  PropHeat Christchurch  –  Property Market Intelligence
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ─────────────────────────────────────────────────────────────────
// CONSTANTS & CONFIG  (unchanged)
// ─────────────────────────────────────────────────────────────────

const CHCH_CENTER = [-43.5321, 172.6362]

const SUBURBS = [
  { name: 'Fendalton',    lat: -43.5201, lng: 172.5982 },
  { name: 'Merivale',     lat: -43.5089, lng: 172.6234 },
  { name: 'Riccarton',    lat: -43.5356, lng: 172.5993 },
  { name: 'Addington',    lat: -43.5449, lng: 172.6119 },
  { name: 'Spreydon',     lat: -43.5556, lng: 172.6070 },
  { name: 'Sydenham',     lat: -43.5472, lng: 172.6281 },
  { name: 'St Albans',    lat: -43.5101, lng: 172.6398 },
  { name: 'Papanui',      lat: -43.4960, lng: 172.6118 },
  { name: 'Burnside',     lat: -43.5050, lng: 172.5820 },
  { name: 'Shirley',      lat: -43.5002, lng: 172.6519 },
  // Coastal suburbs: centroid moved inland + hard bounds to prevent sea placement
  { name: 'New Brighton', lat: -43.5019, lng: 172.715,  maxLng: 172.733 },
  { name: 'Sumner',       lat: -43.5775, lng: 172.748,  maxLng: 172.763, maxLat: -43.571 },
  { name: 'Cashmere',     lat: -43.5701, lng: 172.6475 },
  { name: 'Halswell',     lat: -43.5870, lng: 172.5856 },
  { name: 'Wigram',       lat: -43.5639, lng: 172.5784 },
  { name: 'Hornby',       lat: -43.5660, lng: 172.5484 },
  { name: 'Belfast',      lat: -43.4637, lng: 172.6221 },
]
const SUBURB_BY_NAME = Object.fromEntries(SUBURBS.map(s => [s.name, s]))
const SUBURB_NAMES   = SUBURBS.map(s => s.name)

const STREET_NAMES = [
  'High St', 'Main Rd', 'Park Ave', 'Church St', 'Victoria St',
  'Albert St', 'Edward Ave', 'George St', 'King St', 'Oxford Tce',
  'Cambridge Tce', 'Durham St', 'Fitzgerald Ave', 'Bealey Ave',
  'Papanui Rd', 'Fendalton Rd', 'Cashmere Rd', 'Halswell Rd',
  'Bryndwr Rd', 'Wairakei Rd', 'Idris Rd', 'Clyde Rd', 'Opawa Rd',
  'Harewood Rd', 'Linwood Ave', 'Montreal St', 'Ferry Rd',
  'Colombo St', 'Manchester St', 'Tuam St', 'St Asaph St',
]

const SCHOOL_ZONES = [
  'Burnside High', 'Riccarton High', 'Cashmere High', "Shirley Boys'",
  'CGHS', "St Andrew's", 'Papanui High', "Avonside Girls'", 'Linwood College',
  'Hornby High', 'Halswell School', 'Belfast School', "St Bede's", 'Rangi Ruru',
]

const PROP_TYPES = ['house+land', 'land', 'residential', 'new build']

const PROP_TYPE_CDF = [0.43, 0.55, 0.83, 1.00]
const PROP_TYPE_MAP = ['residential', 'land', 'house+land', 'new build']

const INITIAL_FILTERS = {
  maxDaysOnMarket:      90,
  minPageViews:          0,
  minWatchlistCount:     0,
  selectedSuburbs:      [],
  maxEstimatedValue:    700_000,
  minLandSize:          1_000,
  selectedPropTypes:    [...PROP_TYPES],
  maxDistanceToHotspot: 1,
}

// ─────────────────────────────────────────────────────────────────
// UTILITIES  (unchanged)
// ─────────────────────────────────────────────────────────────────

function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtNZD(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}m`
  return `$${Math.round(v / 1000)}k`
}

function heatColor(score) {
  if (score >= 80) return '#dc2626'  // red-600
  if (score >= 65) return '#ea580c'  // orange-600
  if (score >= 50) return '#f97316'  // orange-500
  if (score >= 35) return '#eab308'  // yellow-500
  if (score >= 20) return '#3b82f6'  // blue-500
  return '#06b6d4'                   // cyan-500
}

function heatLabel(score) {
  if (score >= 80) return 'Extreme'
  if (score >= 65) return 'Very Hot'
  if (score >= 50) return 'Hot'
  if (score >= 35) return 'Warm'
  if (score >= 20) return 'Mild'
  return 'Cool'
}

// ─────────────────────────────────────────────────────────────────
// DATA GENERATION  (unchanged)
// ─────────────────────────────────────────────────────────────────

function generateProperties() {
  const rand    = seededRng(42)
  const pick    = arr => arr[Math.floor(rand() * arr.length)]
  const ri      = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const rf      = (lo, hi) => lo + rand() * (hi - lo)
  const round1k = v => Math.round(v / 1000) * 1000
  const pickCdf = (cdf, vals) => { const r = rand(); return vals[cdf.findIndex(c => r < c)] }

  const props = []

  props.push({
    id: 'demo-1', address: '45 High Street', suburb: 'Addington',
    lat: -43.5440, lng: 172.6130,
    bedrooms: 3, bathrooms: 2, garage: true,
    landSizeSqm: 650, floorSizeSqm: 180, propertyType: 'residential',
    estimatedValueNZD: 1_300_000, soldPriceNZD: 1_300_000, dateSold: '2024-02-15',
    daysOnMarket: 3, pageViews: 3200, watchlistCount: 145,
    yearBuilt: 1985, schoolZone: 'Cashmere High',
    nearPublicTransport: true, nearPark: true, distanceToCityCentreKm: 2.1,
  })

  props.push({
    id: 'demo-2', address: '20 High Street', suburb: 'Addington',
    lat: -43.5460, lng: 172.6105,
    bedrooms: 3, bathrooms: 1, garage: false,
    landSizeSqm: 1200, floorSizeSqm: 110, propertyType: 'house+land',
    estimatedValueNZD: 700_000, soldPriceNZD: 300_000, dateSold: '2008-05-20',
    daysOnMarket: null, pageViews: 890, watchlistCount: 42,
    yearBuilt: 1923, schoolZone: 'Cashmere High',
    nearPublicTransport: true, nearPark: false, distanceToCityCentreKm: 2.2,
  })

  for (let i = 2; i < 500; i++) {
    const suburb   = pick(SUBURBS)
    const propType = pickCdf(PROP_TYPE_CDF, PROP_TYPE_MAP)
    const isLand   = propType === 'land'
    const isSold   = rand() > 0.38
    const dom      = isSold ? ri(1, 90) : null
    const price    = round1k(rf(350_000, 2_500_000))
    const land     = ri(300, 2500)
    const floor    = isLand ? 0 : ri(80, 380)

    props.push({
      id: `p${i}`,
      address: `${ri(1, 250)} ${pick(STREET_NAMES)}`,
      suburb: suburb.name,
      lat: Math.min(suburb.maxLat ?? Infinity,  suburb.lat + (rand() - 0.5) * 0.028),
      lng: Math.min(suburb.maxLng ?? Infinity,  suburb.lng + (rand() - 0.5) * 0.030),
      bedrooms:  isLand ? 0 : ri(1, 6),
      bathrooms: isLand ? 0 : ri(1, 4),
      garage: rand() > 0.35,
      landSizeSqm:  land,
      floorSizeSqm: floor,
      propertyType: propType,
      estimatedValueNZD: price,
      soldPriceNZD: isSold ? round1k(price * rf(0.87, 1.13)) : null,
      dateSold: isSold
        ? `${ri(2020, 2024)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`
        : null,
      daysOnMarket:   dom,
      pageViews:      ri(30, 5000),
      watchlistCount: ri(0, 200),
      yearBuilt:      ri(1920, 2024),
      schoolZone:     pick(SCHOOL_ZONES),
      nearPublicTransport: rand() > 0.30,
      nearPark:            rand() > 0.40,
      distanceToCityCentreKm: parseFloat(
        (haversineKm(suburb.lat, suburb.lng, -43.5321, 172.6362) * rf(0.85, 1.15)).toFixed(1),
      ),
    })
  }
  return props
}

// ─────────────────────────────────────────────────────────────────
// SCORING  (unchanged)
// ─────────────────────────────────────────────────────────────────

function computeHeatScore(prop) {
  const domScore   = prop.daysOnMarket != null
    ? Math.max(0, 100 - (prop.daysOnMarket / 90) * 100)
    : 50
  const viewScore  = Math.min(100, (prop.pageViews / 5000) * 100)
  const watchScore = Math.min(100, (prop.watchlistCount / 200) * 100)
  return Math.round(domScore * 0.4 + viewScore * 0.3 + watchScore * 0.3)
}

function computeSuburbHeats(properties) {
  const acc = {}
  for (const p of properties) {
    if (!acc[p.suburb]) acc[p.suburb] = { total: 0, count: 0 }
    acc[p.suburb].total += p.heatScore
    acc[p.suburb].count++
  }
  return Object.entries(acc).map(([name, { total, count }]) => ({
    name,
    avgHeat: Math.round(total / count),
    count,
    ...(SUBURB_BY_NAME[name] ?? {}),
  }))
}

// ─────────────────────────────────────────────────────────────────
// STATIC DATASET
// ─────────────────────────────────────────────────────────────────

const ALL_PROPERTIES = generateProperties().map(p => ({
  ...p,
  heatScore: computeHeatScore(p),
}))

// ─────────────────────────────────────────────────────────────────
// LEAFLET POPUP HTML  (light theme)
// ─────────────────────────────────────────────────────────────────

function buildPopupHTML(prop) {
  const priceStr = prop.soldPriceNZD ? fmtNZD(prop.soldPriceNZD) : fmtNZD(prop.estimatedValueNZD)
  const priceTag = prop.soldPriceNZD ? 'sold' : 'est.'
  const col      = heatColor(prop.heatScore)
  const bedRow   = prop.bedrooms
    ? `<tr><td style="padding-right:10px;color:#9ca3af">🛏</td><td>${prop.bedrooms} bed / ${prop.bathrooms} bath${prop.garage ? ' / garage' : ''}</td></tr>`
    : ''
  const domRow   = prop.daysOnMarket != null
    ? `<tr><td style="color:#9ca3af">⏱</td><td style="color:${prop.daysOnMarket <= 10 ? '#ea580c' : '#374151'}">${prop.daysOnMarket} days on market</td></tr>`
    : ''

  return `
    <div style="min-width:240px;font-family:'Inter',system-ui,sans-serif">
      <div style="font-weight:700;font-size:14px;color:#111827;line-height:1.3;margin-bottom:2px">${prop.address}</div>
      <div style="color:#9ca3af;font-size:11px;margin-bottom:10px">${prop.suburb} · ${prop.propertyType}</div>
      <div style="margin-bottom:12px;display:flex;align-items:baseline;gap:6px">
        <span style="color:#1e40af;font-weight:700;font-size:18px">${priceStr}</span>
        <span style="color:#9ca3af;font-size:11px">${priceTag}</span>
      </div>
      <table style="font-size:12px;color:#374151;border-collapse:collapse;width:100%;line-height:1.9">
        ${bedRow}
        <tr>
          <td style="padding-right:10px;color:#9ca3af">📐</td>
          <td>${prop.landSizeSqm.toLocaleString()}m² land${prop.floorSizeSqm ? ` · ${prop.floorSizeSqm}m² floor` : ''}</td>
        </tr>
        <tr><td style="color:#9ca3af">🏗</td><td>Built ${prop.yearBuilt}</td></tr>
        <tr><td style="color:#9ca3af">🏫</td><td>${prop.schoolZone}</td></tr>
        <tr><td style="color:#9ca3af">👀</td><td>${prop.pageViews.toLocaleString()} views · ❤️ ${prop.watchlistCount} saved</td></tr>
        ${domRow}
      </table>
      <div style="margin-top:12px;padding:5px 10px;border-radius:20px;background:${col}18;border:1px solid ${col}40;display:inline-flex;align-items:center;gap:6px">
        <div style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0"></div>
        <span style="color:${col};font-weight:600;font-size:11px">Heat ${prop.heatScore}/100 · ${heatLabel(prop.heatScore)}</span>
      </div>
    </div>
  `
}

// ═════════════════════════════════════════════════════════════════
// SUB-COMPONENTS  (light theme)
// ═════════════════════════════════════════════════════════════════

// ── Stats card ────────────────────────────────────────────────────
function StatCard({ label, value, color, icon }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white border border-slate-200 shadow-sm min-w-[130px] shrink-0">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
        style={{ background: color + '15' }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-none mb-0.5">{label}</div>
        <div className="text-sm font-bold text-slate-800 leading-none">{value}</div>
      </div>
    </div>
  )
}

// ── Range slider ──────────────────────────────────────────────────
function RangeSlider({ label, min, max, value, step = 1, format, onChange, variant = 'hot' }) {
  const cls = variant === 'bargain' ? 'bargain-slider' : 'hot-slider'
  const valColor = variant === 'bargain' ? '#16a34a' : '#ea580c'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        <span className="text-xs font-semibold" style={{ color: valColor }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        className={cls}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ── Suburb multi-select ───────────────────────────────────────────
function SuburbMultiSelect({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const toggle = name =>
    onChange(selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name])

  const label = selected.length === 0
    ? 'All suburbs'
    : `${selected.length} suburb${selected.length > 1 ? 's' : ''}`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full text-left text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-slate-600 flex justify-between items-center hover:border-blue-400 hover:bg-blue-50/50 transition-all"
      >
        <span>{label}</span>
        <svg
          className="w-3 h-3 text-slate-400 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-[2000] bg-white border border-slate-200 rounded-xl mt-1 shadow-xl overflow-hidden">
          <div className="max-h-44 overflow-y-auto p-1">
            {SUBURB_NAMES.map(name => (
              <label
                key={name}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700 transition-colors"
              >
                <input
                  type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)}
                  className="w-3.5 h-3.5 accent-blue-600 rounded"
                />
                {name}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-slate-100 p-1.5">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Collapsible filter sidebar (LEFT) ─────────────────────────────
function FilterSidebar({ filters, onChange, open, onToggle }) {
  const set = key => val => onChange(key, val)

  return (
    <aside
      className="shrink-0 bg-white flex flex-col relative z-10"
      style={{
        width: open ? '272px' : '48px',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '2px 0 12px rgba(0,0,0,0.06)',
        borderRight: '1px solid #e2e8f0',
        overflow: 'hidden',
      }}
    >
      {/* Burger row – always visible */}
      <div className="h-12 flex items-center gap-2.5 px-3 border-b border-slate-100 shrink-0">
        <button
          onClick={onToggle}
          title={open ? 'Collapse filters' : 'Expand filters'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0"
        >
          {/* Hamburger SVG */}
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Label – fades in when open */}
        <span
          className="font-semibold text-slate-700 text-sm whitespace-nowrap"
          style={{
            opacity: open ? 1 : 0,
            transition: 'opacity 0.15s ease',
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
          Filters
        </span>
      </div>

      {/* Scrollable filter content */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          opacity: open ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Inner fixed-width container so content doesn't reflow during transition */}
        <div className="p-4" style={{ width: '240px' }}>

          {/* ── Hot Filters ── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-orange-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600">
                Hot Filters
              </span>
            </div>
            <div className="flex flex-col gap-4">
              <RangeSlider
                label="Max days on market"
                min={1} max={90} value={filters.maxDaysOnMarket}
                format={v => `${v}d`}
                onChange={set('maxDaysOnMarket')}
                variant="hot"
              />
              <RangeSlider
                label="Min page views"
                min={0} max={5000} step={50} value={filters.minPageViews}
                format={v => v.toLocaleString()}
                onChange={set('minPageViews')}
                variant="hot"
              />
              <RangeSlider
                label="Min watchlist count"
                min={0} max={200} value={filters.minWatchlistCount}
                onChange={set('minWatchlistCount')}
                variant="hot"
              />
              <div>
                <div className="text-xs text-slate-500 font-medium mb-1.5">Suburb</div>
                <SuburbMultiSelect selected={filters.selectedSuburbs} onChange={set('selectedSuburbs')} />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100 mb-6" />

          {/* ── Bargain Filters ── */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Bargain Filters
              </span>
            </div>
            <div className="flex flex-col gap-4">
              <RangeSlider
                label="Max estimated value"
                min={200000} max={1500000} step={25000} value={filters.maxEstimatedValue}
                format={fmtNZD}
                onChange={set('maxEstimatedValue')}
                variant="bargain"
              />
              <RangeSlider
                label="Min land size"
                min={200} max={3000} step={50} value={filters.minLandSize}
                format={v => `${v.toLocaleString()}m²`}
                onChange={set('minLandSize')}
                variant="bargain"
              />
              <div>
                <div className="text-xs text-slate-500 font-medium mb-2">Property type</div>
                <div className="flex flex-col gap-1.5">
                  {PROP_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:text-slate-800 transition-colors">
                      <input
                        type="checkbox"
                        checked={filters.selectedPropTypes.includes(t)}
                        onChange={() => {
                          const next = filters.selectedPropTypes.includes(t)
                            ? filters.selectedPropTypes.filter(x => x !== t)
                            : [...filters.selectedPropTypes, t]
                          onChange('selectedPropTypes', next)
                        }}
                        className="w-3.5 h-3.5 accent-emerald-600 rounded"
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <RangeSlider
                label="Max distance to hotspot"
                min={0.5} max={5} step={0.5} value={filters.maxDistanceToHotspot}
                format={v => `${v}km`}
                onChange={set('maxDistanceToHotspot')}
                variant="bargain"
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ── Heat badge ────────────────────────────────────────────────────
function HeatBadge({ score }) {
  const color = heatColor(score)
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
      style={{ background: color + '18', color, border: `1px solid ${color}35` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {score} · {heatLabel(score)}
    </span>
  )
}

// ── Property card ─────────────────────────────────────────────────
function PropertyCard({ prop, onViewOnMap, isBargain }) {
  const price      = prop.soldPriceNZD ?? prop.estimatedValueNZD
  const priceLabel = prop.soldPriceNZD ? 'Sold' : 'Est.'

  return (
    <div className="bg-white rounded-xl p-3.5 border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 shadow-sm">
      {/* Address row */}
      <div className="flex justify-between items-start gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{prop.address}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{prop.suburb} · {prop.propertyType}</div>
        </div>
        {isBargain && (
          <span
            className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0"
          >
            💰 Bargain
          </span>
        )}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1.5 mb-2.5">
        <span className="font-bold text-blue-700 text-base">{fmtNZD(price)}</span>
        <span className="text-[10px] text-slate-400 font-medium">{priceLabel}</span>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-slate-500 mb-3">
        {prop.bedrooms > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-slate-300">🛏</span>{prop.bedrooms}bd/{prop.bathrooms}ba
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="text-slate-300">📐</span>{prop.landSizeSqm.toLocaleString()}m²
        </span>
        {prop.floorSizeSqm > 0 && (
          <span className="flex items-center gap-1">
            <span className="text-slate-300">🏗</span>{prop.floorSizeSqm}m²
          </span>
        )}
        {prop.daysOnMarket != null && (
          <span
            className="flex items-center gap-1 font-medium"
            style={{ color: prop.daysOnMarket <= 10 ? '#ea580c' : undefined }}
          >
            <span>⏱</span>{prop.daysOnMarket}d on market
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <HeatBadge score={prop.heatScore} />
        <button
          onClick={() => onViewOnMap(prop)}
          className="text-[11px] font-medium text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white hover:border-blue-600 px-2.5 py-1 rounded-full transition-all duration-150 shrink-0"
        >
          View on map →
        </button>
      </div>
    </div>
  )
}

// ── Property list sidebar (RIGHT) ─────────────────────────────────
function Sidebar({ hotProperties, bargains, onViewOnMap, activeTab, onTabChange, bargainIds }) {
  const items = activeTab === 'hot' ? hotProperties : bargains
  const tabs = [
    { id: 'hot',      label: '🔥 Hot',     count: hotProperties.length, activeColor: '#ea580c', activeBg: '#fff7ed' },
    { id: 'bargains', label: '💰 Bargains', count: bargains.length,      activeColor: '#16a34a', activeBg: '#f0fdf4' },
  ]

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Tab row */}
      <div className="flex shrink-0 border-b border-slate-100">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-all duration-200"
            style={{
              color:        activeTab === tab.id ? tab.activeColor : '#9ca3af',
              borderBottom: activeTab === tab.id ? `2px solid ${tab.activeColor}` : '2px solid transparent',
              background:   activeTab === tab.id ? tab.activeBg : 'transparent',
            }}
          >
            {tab.label}&nbsp;
            <span className="font-normal opacity-70">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-slate-50/60">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-36 text-slate-400 text-sm text-center">
            <span className="text-3xl mb-2 opacity-40">🔍</span>
            No properties match the current filters
          </div>
        ) : (
          items.map(prop => (
            <PropertyCard
              key={prop.id}
              prop={prop}
              onViewOnMap={onViewOnMap}
              isBargain={bargainIds.has(prop.id)}
            />
          ))
        )}
        {activeTab === 'hot' && hotProperties.length >= 20 && (
          <div className="text-center text-xs text-slate-400 py-2 shrink-0">
            Showing top 20 by heat score
          </div>
        )}
      </div>
    </div>
  )
}

// ── Map legend (bottom-left overlay) ─────────────────────────────
function MapLegend({ layerVisibility, onToggle }) {
  const layers = [
    { key: 'heat',       label: 'Heat circles', dot: '#f97316' },
    { key: 'properties', label: 'Properties',   dot: '#3b82f6' },
    { key: 'bargains',   label: 'Bargains ⭐',  dot: '#16a34a' },
  ]
  const heatLevels = [
    { color: '#dc2626', label: '80+ Extreme' },
    { color: '#ea580c', label: '65+ Very Hot' },
    { color: '#f97316', label: '50+ Hot' },
    { color: '#eab308', label: '35+ Warm' },
    { color: '#3b82f6', label: '20+ Mild' },
    { color: '#06b6d4', label: '<20 Cool' },
  ]

  return (
    <div className="absolute bottom-5 left-4 z-[1000] bg-white border border-slate-200 rounded-2xl p-3.5 text-xs shadow-lg min-w-[164px]">
      <div className="font-bold text-slate-600 mb-2.5 text-[10px] uppercase tracking-widest">
        Layers
      </div>
      {layers.map(({ key, label, dot }) => (
        <label key={key} className="flex items-center gap-2 mb-2 cursor-pointer group">
          <input
            type="checkbox" checked={layerVisibility[key]} onChange={() => onToggle(key)}
            className="w-3.5 h-3.5 accent-blue-600 rounded"
          />
          <span
            className="w-2 h-2 rounded-full shrink-0 transition-colors duration-200"
            style={{ background: layerVisibility[key] ? dot : '#cbd5e1' }}
          />
          <span
            className="transition-colors duration-200"
            style={{ color: layerVisibility[key] ? '#374151' : '#9ca3af' }}
          >
            {label}
          </span>
        </label>
      ))}

      <div className="border-t border-slate-100 mt-3 pt-3">
        <div className="text-[9px] uppercase tracking-widest text-slate-400 mb-2">Heat Score</div>
        {heatLevels.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════

export default function App() {
  const [filters, setFilters]               = useState(INITIAL_FILTERS)
  const [activeTab, setActiveTab]           = useState('hot')
  const [sidebarOpen, setSidebarOpen]       = useState(true)
  const [layerVisibility, setLayerVisibility] = useState({ heat: true, properties: true, bargains: true })

  // Leaflet refs
  const mapContainerRef  = useRef(null)
  const mapRef           = useRef(null)
  const heatLayerRef     = useRef(null)
  const markersLayerRef  = useRef(null)
  const bargainsLayerRef = useRef(null)
  const markersById      = useRef(new Map())

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  // ── Derived data (unchanged logic) ───────────────────────────────

  const filteredProperties = useMemo(() => {
    return ALL_PROPERTIES.filter(p => {
      if (filters.selectedSuburbs.length > 0 && !filters.selectedSuburbs.includes(p.suburb)) return false
      if (p.daysOnMarket != null && p.daysOnMarket > filters.maxDaysOnMarket) return false
      if (p.pageViews      < filters.minPageViews)     return false
      if (p.watchlistCount < filters.minWatchlistCount) return false
      return true
    })
  }, [filters.maxDaysOnMarket, filters.minPageViews, filters.minWatchlistCount, filters.selectedSuburbs])

  const suburbHeats = useMemo(() => computeSuburbHeats(filteredProperties), [filteredProperties])

  const hotSuburbs = useMemo(
    () => suburbHeats.filter(s => s.avgHeat >= 50 && s.lat != null),
    [suburbHeats],
  )

  const bargains = useMemo(() => {
    if (hotSuburbs.length === 0) return []
    return ALL_PROPERTIES.filter(p => {
      if (p.estimatedValueNZD > filters.maxEstimatedValue)            return false
      if (p.landSizeSqm       < filters.minLandSize)                  return false
      if (!filters.selectedPropTypes.includes(p.propertyType))         return false
      return hotSuburbs.some(
        s => haversineKm(p.lat, p.lng, s.lat, s.lng) <= filters.maxDistanceToHotspot,
      )
    })
  }, [filters.maxEstimatedValue, filters.minLandSize, filters.selectedPropTypes, filters.maxDistanceToHotspot, hotSuburbs])

  const bargainIds = useMemo(() => new Set(bargains.map(p => p.id)), [bargains])

  const hotProperties = useMemo(
    () => [...filteredProperties].sort((a, b) => b.heatScore - a.heatScore).slice(0, 20),
    [filteredProperties],
  )

  const stats = useMemo(() => {
    const hotCount = filteredProperties.filter(p => p.heatScore >= 60).length
    const withDom  = filteredProperties.filter(p => p.daysOnMarket != null)
    const avgDom   = withDom.length
      ? Math.round(withDom.reduce((s, p) => s + p.daysOnMarket, 0) / withDom.length)
      : 0
    const hottestSuburb = suburbHeats.reduce(
      (best, s) => (!best || s.avgHeat > best.avgHeat ? s : best), null,
    )
    return { hotCount, avgDom, bargainCount: bargains.length, hottestSuburb: hottestSuburb?.name ?? '—' }
  }, [filteredProperties, suburbHeats, bargains])

  // ── Map initialisation ────────────────────────────────────────────

  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: CHCH_CENTER,
      zoom: 12,
      zoomControl: true,
    })

    // Light Voyager tiles to match the light theme
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      },
    ).addTo(map)

    heatLayerRef.current     = L.layerGroup().addTo(map)
    markersLayerRef.current  = L.layerGroup().addTo(map)
    bargainsLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
  }, [])

  // Invalidate map size when sidebar opens/closes (map container width changes)
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 320)
    return () => clearTimeout(t)
  }, [sidebarOpen])

  // ── Heat circles ──────────────────────────────────────────────────

  useEffect(() => {
    const layer = heatLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!layerVisibility.heat) return

    for (const suburb of suburbHeats) {
      if (!suburb.lat) continue
      const color  = heatColor(suburb.avgHeat)
      const radius = 350 + (suburb.avgHeat / 100) * 750
      const circle = L.circle([suburb.lat, suburb.lng], {
        radius,
        color,
        fillColor:   color,
        fillOpacity: 0.12 + (suburb.avgHeat / 100) * 0.28,
        weight:      2,
        opacity:     0.65,
        className:   suburb.avgHeat >= 60 ? 'heat-pulse' : '',
      })
      circle.bindTooltip(
        `<b>${suburb.name}</b><br>Heat: <b style="color:${color}">${suburb.avgHeat}/100</b> · ${heatLabel(suburb.avgHeat)}<br>${suburb.count} properties`,
        { className: 'leaflet-tooltip-light', sticky: true },
      )
      layer.addLayer(circle)
    }
  }, [suburbHeats, layerVisibility.heat])

  // ── Property dot markers ──────────────────────────────────────────

  useEffect(() => {
    const layer = markersLayerRef.current
    if (!layer) return
    layer.clearLayers()
    markersById.current.clear()
    if (!layerVisibility.properties) return

    for (const prop of filteredProperties) {
      const color = heatColor(prop.heatScore)
      const icon  = L.divIcon({
        className: '',
        html: `<div style="
          width:10px;height:10px;border-radius:50%;
          background:${color};
          border:2px solid rgba(255,255,255,0.9);
          box-shadow:0 1px 4px rgba(0,0,0,0.25),0 0 0 1px ${color}44;
        "></div>`,
        iconSize:   [10, 10],
        iconAnchor: [5, 5],
      })
      const marker = L.marker([prop.lat, prop.lng], { icon })
      marker.bindPopup(buildPopupHTML(prop), { maxWidth: 300 })
      layer.addLayer(marker)
      markersById.current.set(prop.id, marker)
    }
  }, [filteredProperties, layerVisibility.properties])

  // ── Bargain star markers ──────────────────────────────────────────

  useEffect(() => {
    const layer = bargainsLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!layerVisibility.bargains) return

    for (const prop of bargains) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:24px;height:24px;border-radius:50%;
          background:#fff;
          border:2px solid #16a34a;
          box-shadow:0 2px 8px rgba(22,163,74,0.35),0 1px 3px rgba(0,0,0,0.12);
          display:flex;align-items:center;justify-content:center;
          font-size:13px;cursor:pointer;
        ">⭐</div>`,
        iconSize:   [24, 24],
        iconAnchor: [12, 12],
      })
      const marker = L.marker([prop.lat, prop.lng], { icon, zIndexOffset: 500 })
      marker.bindPopup(buildPopupHTML(prop), { maxWidth: 300 })
      layer.addLayer(marker)
      markersById.current.set(prop.id, marker)
    }
  }, [bargains, layerVisibility.bargains])

  // ── Fly-to + popup ────────────────────────────────────────────────

  const handleViewOnMap = useCallback(prop => {
    const map = mapRef.current
    if (!map) return
    map.flyTo([prop.lat, prop.lng], 16, { duration: 1.2, easeLinearity: 0.3 })
    setTimeout(() => markersById.current.get(prop.id)?.openPopup(), 1350)
  }, [])

  const toggleLayer = useCallback(key => {
    setLayerVisibility(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Top navbar ────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-5 py-2.5 bg-white border-b border-slate-200 shadow-sm">

        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 text-white"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            🔥
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-none tracking-tight">
              PropHeat Christchurch
            </h1>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5 uppercase tracking-widest">
              Property Market Intelligence · NZ
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-2">
          <StatCard label="Hot Properties"  value={stats.hotCount}      color="#ea580c" icon="🔥" />
<StatCard label="Bargains Found"  value={stats.bargainCount}  color="#16a34a" icon="💰" />
          <StatCard label="Hottest Suburb"  value={stats.hottestSuburb} color="#7c3aed" icon="📍" />
        </div>
      </header>

      {/* ── Body row ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left filter sidebar */}
        <FilterSidebar
          filters={filters}
          onChange={updateFilter}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
        />

        {/* Map area */}
        <div className="relative flex-1 min-h-0">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <MapLegend layerVisibility={layerVisibility} onToggle={toggleLayer} />
        </div>

        {/* Right property list sidebar */}
        <div className="w-[360px] shrink-0 flex flex-col border-l border-slate-200 min-h-0 shadow-[-2px_0_12px_rgba(0,0,0,0.04)]">
          <Sidebar
            hotProperties={hotProperties}
            bargains={bargains}
            onViewOnMap={handleViewOnMap}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            bargainIds={bargainIds}
          />
        </div>
      </div>
    </div>
  )
}
