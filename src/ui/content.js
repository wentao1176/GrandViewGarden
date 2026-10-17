// ─────────────────────────────────────────────────────────────────────────────
// 景点文案的呈现层规整：分组、匾额（初题→元春改题）、楹联、引文来源等。
// 数据源为 window.GVG.pois（由主程序合并 layout.POIS 与 src/data/poi-content.js）。
// 任何字段缺失都不应产生可见的空行；本模块只做归一化，不写死景点内容。
// ─────────────────────────────────────────────────────────────────────────────

/** 分组顺序与配色（用于面板分组、帮助图例、小地图点位）。 */
export const GROUP_DEFS = [
  { key: 'axis', names: ['中轴', '中軸'], label: '中軸', short: '軸', color: '#d8b64b' },
  { key: 'east', names: ['东部', '東部'], label: '東部', short: '東', color: '#c06a4e' },
  { key: 'west', names: ['西部'], label: '西部', short: '西', color: '#8aa07a' },
  { key: 'north', names: ['北部'], label: '北部', short: '北', color: '#7f9dae' },
  { key: 'water', names: ['水系'], label: '水系', short: '水', color: '#5f948e' },
];

const GROUP_LOOKUP = new Map();
for (const def of GROUP_DEFS) {
  for (const name of def.names) GROUP_LOOKUP.set(name, def);
}

const FALLBACK_GROUP = { key: 'other', label: '其他', short: '園', color: '#9a9484' };

export function groupOf(name) {
  return GROUP_LOOKUP.get(String(name || '').trim()) || FALLBACK_GROUP;
}

export function groupLabel(name) {
  return groupOf(name).label;
}

export function groupColor(name) {
  return groupOf(name).color;
}

/** 面板排序：按 GROUP_DEFS 顺序；未知分组排在最后并保持出现顺序。 */
export function groupSortIndex(name) {
  const def = GROUP_LOOKUP.get(String(name || '').trim());
  if (!def) return GROUP_DEFS.length;
  return GROUP_DEFS.indexOf(def);
}

/** 简体/繁体、空白与全角括号的轻量清洗。 */
export function cleanText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function cleanList(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => cleanText(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index);
}

/** 别名 / 赐名前後：统一成字符串数组。 */
export function normalizeAlias(poi) {
  if (!poi) return [];
  return cleanList(poi.alias ?? poi.aliases ?? poi.aka);
}

/**
 * 匾额：支持
 *  - 字符串（可含「→」表示初题→改题）
 *  - 数组 [初题, 改题]
 *  - 对象 { initial, final, source, note }
 * 返回 { initial, final, note } 或 null。
 */
export function normalizePlaque(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const text = cleanText(raw);
    if (!text) return null;
    const parts = text.split(/\s*(?:→|->|⇒|—>|>)\s*/).map(cleanText).filter(Boolean);
    if (parts.length >= 2) {
      return { initial: parts[0], final: parts[parts.length - 1], note: '元春改題' };
    }
    return { initial: '', final: text, note: '' };
  }
  if (Array.isArray(raw)) {
    const parts = raw.map(cleanText).filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) return { initial: '', final: parts[0], note: '' };
    return { initial: parts[0], final: parts[parts.length - 1], note: '元春改題' };
  }
  if (typeof raw === 'object') {
    const initial = cleanText(raw.initial ?? raw.original ?? raw.pre ?? raw['初题'] ?? raw['初題']);
    const final = cleanText(
      raw.final ?? raw.changed ?? raw.after ?? raw.text ?? raw.current ?? raw['改题'] ?? raw['改題'],
    );
    const note = cleanText(raw.note ?? raw.noteText ?? raw.note_text ?? raw.source ?? '');
    if (!initial && !final) return null;
    return { initial, final: final || initial, note };
  }
  return null;
}

/** 楹联：支持字符串、字符串数组、{text,source} 数组；返回 [{text, source}]。 */
export function normalizeCouplets(raw) {
  if (raw === null || raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    if (item === null || item === undefined) continue;
    if (typeof item === 'string') {
      const text = cleanText(item);
      if (text) out.push({ text, source: '' });
      continue;
    }
    if (typeof item === 'object') {
      const text = cleanText(item.text ?? item.content ?? item.line ?? item.value);
      if (!text) continue;
      out.push({ text, source: cleanText(item.source ?? item.from ?? '') });
    }
  }
  return out;
}

/** 把一句联语按分号拆成上下联（仅用于排版，不改内容）。 */
export function splitCoupletLines(text) {
  const value = cleanText(text);
  if (!value) return [];
  const parts = value
    .split(/\s*[；;]\s*/)
    .map((part) => part.replace(/[，,。]$/, '').trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;
  // 上/下联之间常误用逗号：仅在恰好两段时拆成两行
  const halves = value.split(/\s*[，,]\s*/).filter(Boolean);
  if (halves.length === 2) return halves;
  return [value];
}

/** 引文来源：统一成「《紅樓夢》第××回」样式。 */
export function formatSource(source) {
  const text = cleanText(source);
  if (!text) return '《紅樓夢》';
  if (/《|紅樓夢|红楼梦/.test(text)) return text;
  if (/^第.+回/.test(text)) return `《紅樓夢》${text}`;
  return `《紅樓夢》${text}`;
}

/** 引文：可能是字符串，也可能是 [{text, source}] 等；只取主引文。 */
export function normalizeQuote(poi) {
  if (!poi) return { quote: '', source: '' };
  const raw = poi.quote ?? poi.quotes;
  if (typeof raw === 'string') {
    return { quote: cleanText(raw), source: cleanText(poi.source ?? poi.quoteSource) };
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && cleanText(item)) {
        return { quote: cleanText(item), source: cleanText(poi.source) };
      }
      if (item && typeof item === 'object') {
        const text = cleanText(item.text ?? item.quote ?? item.content);
        if (text) return { quote: text, source: cleanText(item.source ?? poi.source) };
      }
    }
  }
  if (raw && typeof raw === 'object') {
    const text = cleanText(raw.text ?? raw.quote ?? raw.content);
    if (text) return { quote: text, source: cleanText(raw.source ?? poi.source) };
  }
  return { quote: '', source: cleanText(poi.source ?? '') };
}

/** 题咏诗：字符串或 {text, source}。 */
export function normalizePoem(poi) {
  if (!poi) return { text: '', source: '' };
  const raw = poi.poem ?? poi.poems;
  if (!raw) return { text: '', source: '' };
  if (typeof raw === 'string') return { text: cleanText(raw), source: cleanText(poi.poemSource ?? '') };
  if (Array.isArray(raw)) {
    const lines = cleanList(raw);
    return { text: lines.join('\n'), source: cleanText(poi.poemSource ?? '') };
  }
  if (typeof raw === 'object') {
    return {
      text: cleanText(raw.text ?? raw.content),
      source: cleanText(raw.source ?? poi.poemSource ?? ''),
    };
  }
  return { text: '', source: '' };
}

/** 关键词标签：数组或分隔字符串。 */
export function normalizeTags(poi) {
  if (!poi) return [];
  const raw = poi.tags ?? poi.keywords;
  if (Array.isArray(raw)) return cleanList(raw).slice(0, 8);
  const text = cleanText(raw);
  if (!text) return [];
  return text
    .split(/[、,，;；/|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** 考据简介：1–3 句简体。 */
export function normalizeDesc(poi) {
  if (!poi) return '';
  if (Array.isArray(poi.desc)) return cleanList(poi.desc).join('');
  return cleanText(poi.desc ?? poi.description);
}

/** 景点名：name 优先，缺失时退回 id（避免空白项）。 */
export function poiName(poi) {
  if (!poi) return '';
  const name = cleanText(poi.name ?? poi.title);
  return name || cleanText(poi.id);
}

/** 把原始 poi 规整成 UI 可直接消费的结构（保留坐标与 group）。 */
export function normalizePoi(raw) {
  const poi = raw && typeof raw === 'object' ? raw : {};
  const quote = normalizeQuote(poi);
  const name = poiName(poi);
  return {
    raw: poi,
    id: cleanText(poi.id),
    name,
    group: cleanText(poi.group || '其他'),
    groupDef: groupOf(poi.group),
    alias: normalizeAlias(poi).filter((alias) => alias !== name),
    plaque: normalizePlaque(poi.plaque ?? poi['匾额'] ?? poi['匾額']),
    couplets: normalizeCouplets(poi.couplets ?? poi.couplet ?? poi['楹联'] ?? poi['楹聯']),
    quote: quote.quote,
    source: quote.source,
    desc: normalizeDesc(poi),
    poem: normalizePoem(poi),
    tags: normalizeTags(poi),
    x: Number(poi.x),
    z: Number(poi.z),
    y: Number(poi.y),
  };
}

/** 两位序号（面板与信息卡使用）。 */
export function ordinal(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return '—';
  return String(n + 1).padStart(2, '0');
}
