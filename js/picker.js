/*
 * tw-menu-picker 選餐核心（純函式，不碰畫面）
 * 瀏覽器：window.Picker；Node：require('./picker.js')
 * 隨機數一律由外部傳入（rng），測試可以用固定種子重現結果。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Picker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 隨機數 ----------
  /** 可重現的隨機數（mulberry32）。同一個種子永遠得到同一串數字，回傳 [0, 1)。 */
  function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pickIndex(rng, n) {
    const r = Number(rng());
    const i = Math.floor((Number.isFinite(r) ? r : 0) * n);
    return Math.min(n - 1, Math.max(0, i));
  }

  // ---------- CSV ----------
  /** 判斷分隔符號：Excel 直接複製貼上是 Tab，存成 CSV 是逗號 */
  function detectDelimiter(text) {
    const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim() !== '') || '';
    let tabs = 0, commas = 0, semis = 0, q = false;
    for (const c of first) {
      if (c === '"') q = !q;
      else if (!q && c === '\t') tabs++;
      else if (!q && c === ',') commas++;
      else if (!q && c === ';') semis++;
    }
    if (tabs && tabs >= commas) return '\t';
    if (!commas && semis) return ';';
    return ',';
  }
  function parseCSV(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    const d = delim || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }
  function loadCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- 菜單 ----------
  const FIELDS = {
    category: ['類別', '分類', 'category'],
    name: ['品名', '名稱', '品項', 'name', 'item'],
    price: ['價格', '售價', '單價', 'price'],
    tags: ['標籤', '食材', '過敏原', 'tags', 'tag'],
    drink: ['是否飲料', '飲料', 'isDrink', 'drink'],
    drinkType: ['飲料類型', '飲品類型', 'drinkType'],
    note: ['備註', '說明', 'note'],
  };
  const COLUMNS = ['類別', '品名', '價格', '標籤', '是否飲料', '飲料類型', '備註'];
  const YES = /^(是|y|yes|true|1|v|o|✓|✔|飲料)$/i;
  const NO = /^(否|n|no|false|0|x|)$/i;
  const DRINK_HINT = /飲|茶|咖啡|拿鐵|果汁|豆漿|米漿|奶昔|鮮奶|可可|汽水/;

  function field(raw, key) {
    const names = FIELDS[key];
    for (const n of names) if (raw[n] !== undefined && raw[n] !== null) return raw[n];
    const lower = Object.keys(raw).find(k => names.some(n => n.toLowerCase() === String(k).trim().toLowerCase()));
    return lower === undefined ? undefined : raw[lower];
  }
  function splitTags(v) {
    if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
    return String(v == null ? '' : v).split(/[、,，;；/|\s]+/).map(s => s.trim()).filter(Boolean);
  }
  /** 「NT$1,200」「35元」「35」都讀成數字；讀不出來回傳 NaN */
  function parsePrice(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[\s,，元$＄]|NT|TWD/gi, '');
    if (s === '') return NaN;
    return Number(s);
  }

  /** 把一列資料（CSV 或 JSON，中文或英文欄位）變成標準品項 */
  function normalizeItem(raw, index) {
    const row = index + 1;
    if (!raw || typeof raw !== 'object') return { error: `第 ${row} 筆：格式不對` };
    const name = String(field(raw, 'name') == null ? '' : field(raw, 'name')).trim();
    if (!name) return { error: `第 ${row} 筆：沒有品名` };
    const price = parsePrice(field(raw, 'price'));
    if (!Number.isInteger(price) || price < 0) return { error: `第 ${row} 筆「${name}」：價格要是 0 以上的整數` };
    const category = String(field(raw, 'category') == null ? '' : field(raw, 'category')).trim() || '其他';
    const drinkType = String(field(raw, 'drinkType') == null ? '' : field(raw, 'drinkType')).trim();
    const dv = field(raw, 'drink');
    let drink;
    if (typeof dv === 'boolean') drink = dv;
    else if (dv !== undefined && YES.test(String(dv).trim())) drink = true;
    else if (dv !== undefined && String(dv).trim() !== '' && NO.test(String(dv).trim())) drink = false;
    else drink = !!drinkType || DRINK_HINT.test(category);
    const note = String(field(raw, 'note') == null ? '' : field(raw, 'note')).trim();
    return {
      item: {
        id: 'i' + row, category, name, price,
        tags: splitTags(field(raw, 'tags')),
        drink,
        drinkType: drink ? (drinkType || category) : '',
        note,
      },
    };
  }

  /** 一串原始資料 → 菜單。壞掉的列會跳過，並列在 errors。 */
  function buildMenu(rawItems, meta) {
    const m = meta || {};
    const errors = [], warnings = [], items = [];
    if (!Array.isArray(rawItems)) return { menu: null, errors: ['菜單裡找不到品項清單'], warnings };
    const seen = new Set();
    rawItems.forEach((raw, i) => {
      const r = normalizeItem(raw, i);
      if (r.error) { errors.push(r.error); return; }
      const k = r.item.name + '|' + r.item.price;
      if (seen.has(k)) warnings.push(`「${r.item.name}」重複出現`);
      seen.add(k);
      items.push(r.item);
    });
    if (!items.length) errors.push('沒有任何可以用的品項');
    const menu = { id: m.id || 'custom', name: m.name || '我的菜單', items };
    if (m.shop) menu.shop = m.shop;
    if (m.extras) menu.extras = m.extras;
    return { menu: items.length ? menu : null, errors, warnings };
  }

  /** 店家貼上的文字：JSON（陣列或 {name, items}）或 CSV／Excel 複製的表格 */
  function parseMenuText(text, meta) {
    const s = String(text || '').replace(/^﻿/, '').trim();
    if (!s) return { menu: null, errors: ['沒有內容'], warnings: [] };
    if (s[0] === '[' || s[0] === '{') {
      let data;
      try { data = JSON.parse(s); } catch (e) { return { menu: null, errors: ['JSON 格式錯誤：' + e.message], warnings: [] }; }
      if (Array.isArray(data)) return buildMenu(data, meta);
      return buildMenu(data.items, Object.assign({}, meta, { name: data.name || (meta && meta.name), shop: data.shop, extras: data.extras }));
    }
    const recs = loadCSV(s);
    if (!recs.length) return { menu: null, errors: ['表格只有標題列，沒有品項'], warnings: [] };
    const head = Object.keys(recs[0]);
    if (!head.some(h => FIELDS.name.includes(h)) || !head.some(h => FIELDS.price.includes(h))) {
      return { menu: null, errors: ['第一列要是欄位名稱，至少要有「品名」和「價格」'], warnings: [] };
    }
    return buildMenu(recs, meta);
  }

  /** 檢查 data/menus.js 的預設菜單（測試和畫面都用） */
  function loadPresets(list) {
    return (Array.isArray(list) ? Array.from(list) : []).map(p => {
      const r = buildMenu(p.items, p);
      return { id: p.id, name: p.name, menu: r.menu, errors: r.errors, warnings: r.warnings };
    });
  }

  function menuToJSON(menu) {
    const out = {
      name: menu.name,
      items: menu.items.map(i => ({
        類別: i.category, 品名: i.name, 價格: i.price, 標籤: i.tags.join('、'),
        是否飲料: i.drink ? '是' : '否', 飲料類型: i.drink ? i.drinkType : '', 備註: i.note || '',
      })),
    };
    if (menu.shop) out.shop = menu.shop;
    if (menu.extras) out.extras = menu.extras;
    return JSON.stringify(out, null, 2);
  }
  function menuToCSV(menu) {
    const lines = [COLUMNS.join(',')].concat(menu.items.map(i => [
      i.category, i.name, i.price, i.tags.join('、'), i.drink ? '是' : '否', i.drink ? i.drinkType : '', i.note || '',
    ].map(csvCell).join(',')));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 菜單裡有哪些類別、飲料類型、標籤（給畫面做勾選） */
  function menuFacets(items) {
    const uniq = a => Array.from(new Set(a.filter(Boolean)));
    return {
      categories: uniq(items.filter(i => !i.drink).map(i => i.category)),
      drinkTypes: uniq(items.filter(i => i.drink).map(i => i.drinkType)),
      tags: uniq([].concat.apply([], items.map(i => i.tags))),
    };
  }

  // ---------- 篩選 ----------
  function parseBudget(v) {
    if (v === null || v === undefined || v === '' || v === Infinity) return Infinity;
    const n = parsePrice(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Infinity;
  }
  /** 不要的食材：對標籤完全相符，或品名裡有這個字 */
  function isExcluded(item, terms) {
    return terms.some(t => {
      const low = t.toLowerCase();
      return item.tags.some(g => g.toLowerCase() === low) || item.name.toLowerCase().includes(low);
    });
  }
  function filterItems(items, f) {
    const o = f || {};
    const cats = o.categories || [], types = o.drinkTypes || [];
    const terms = splitTags(o.exclude);
    const ok = (items || []).filter(i => !isExcluded(i, terms));
    return {
      mains: ok.filter(i => !i.drink && (!cats.length || cats.includes(i.category))),
      drinks: ok.filter(i => i.drink && (!types.length || types.includes(i.drinkType))),
    };
  }

  // ---------- 抽選 ----------
  function comboOf(main, drink) {
    return {
      main: main || null,
      drink: drink || null,
      total: (main ? main.price : 0) + (drink ? drink.price : 0),
      key: (main ? main.id : '-') + '+' + (drink ? drink.id : '-'),
    };
  }
  function resolveMode(mode, mains, drinks) {
    if (mode === 'combo' || mode === 'main' || mode === 'drink') return mode;
    if (mains.length && drinks.length) return 'combo';
    return mains.length ? 'main' : 'drink';
  }
  /** 預算內所有可能的組合 */
  function candidates(mains, drinks, mode, cap) {
    const out = [];
    if (mode === 'main') mains.forEach(m => { if (m.price <= cap) out.push(comboOf(m, null)); });
    else if (mode === 'drink') drinks.forEach(d => { if (d.price <= cap) out.push(comboOf(null, d)); });
    else {
      const ds = drinks.slice().sort((a, b) => a.price - b.price);
      mains.forEach(m => {
        for (const d of ds) {
          if (m.price + d.price > cap) break;
          out.push(comboOf(m, d));
        }
      });
    }
    return out;
  }
  function cheapest(mains, drinks, mode) {
    const min = a => a.length ? Math.min.apply(null, a.map(i => i.price)) : Infinity;
    if (mode === 'main') return min(mains);
    if (mode === 'drink') return min(drinks);
    return min(mains) + min(drinks);
  }
  function emptyReason(mains, drinks, mode) {
    if (mode !== 'drink' && !mains.length) return '篩選後沒有主餐可以選，請放寬類別或不要的食材。';
    if (mode !== 'main' && !drinks.length) return '篩選後沒有飲料可以選，請放寬飲料類型或改成「只要主餐」。';
    return '';
  }
  function withExtras(combo, extras, rng) {
    if (!combo.drink || !extras) return combo;
    const picked = {};
    Object.keys(extras).forEach(k => {
      const list = extras[k];
      if (Array.isArray(list) && list.length) picked[k] = list[pickIndex(rng, list.length)];
    });
    return Object.keys(picked).length ? Object.assign({}, combo, { extras: picked }) : combo;
  }

  /**
   * 抽一份。opts：
   *   mode: 'auto' | 'combo'（主餐＋飲料）| 'main' | 'drink'
   *   budget: 總價上限（空白＝不限），絕對不會超過
   *   categories, drinkTypes, exclude: 篩選
   *   avoid: 最近抽過的組合 key（盡量不重複；真的沒得換才會重複，並標記 repeated）
   *   extras: { 甜度: [...], 冰塊: [...] } 飲料隨機附加選項
   *   rng: 隨機數函式（必填才能重現；沒給就用 Math.random）
   */
  function pickCombo(items, opts) {
    const o = opts || {};
    const rng = o.rng || Math.random;
    const budget = parseBudget(o.budget);
    const { mains, drinks } = filterItems(items, o);
    const mode = resolveMode(o.mode, mains, drinks);
    const empty = emptyReason(mains, drinks, mode);
    if (empty) return { ok: false, mode, message: empty };
    const all = candidates(mains, drinks, mode, budget);
    if (!all.length) {
      return { ok: false, mode, message: `預算 ${budget} 元不夠：符合條件最便宜的要 ${cheapest(mains, drinks, mode)} 元。` };
    }
    const avoid = new Set(o.avoid || []);
    const fresh = all.filter(c => !avoid.has(c.key));
    const pool = fresh.length ? fresh : all;
    const combo = withExtras(pool[pickIndex(rng, pool.length)], o.extras, rng);
    return { ok: true, mode, combo, poolSize: all.length, repeated: !fresh.length };
  }

  /**
   * 團體訂餐：people 個人、總預算 budget（可加每人上限 perPerson），全部加起來絕不超過預算。
   * 做法：每抽一個人，都先保留「剩下的人各點最便宜」所需的錢，所以只要一開始可行就一定排得完。
   */
  function pickGroup(items, opts) {
    const o = opts || {};
    const rng = o.rng || Math.random;
    const people = Math.floor(Number(o.people));
    if (!Number.isFinite(people) || people < 1) return { ok: false, message: '人數至少 1 人。' };
    if (people > 200) return { ok: false, message: '人數太多了（上限 200 人）。' };
    const budget = parseBudget(o.budget);
    const per = parseBudget(o.perPerson);
    const { mains, drinks } = filterItems(items, o);
    const mode = resolveMode(o.mode, mains, drinks);
    const empty = emptyReason(mains, drinks, mode);
    if (empty) return { ok: false, mode, message: empty };
    const all = candidates(mains, drinks, mode, Math.min(per, budget));
    if (!all.length) {
      return { ok: false, mode, message: `每人預算不夠：符合條件最便宜的要 ${cheapest(mains, drinks, mode)} 元。` };
    }
    const min = Math.min.apply(null, all.map(c => c.total));
    if (people * min > budget) {
      return { ok: false, mode, message: `${people} 人最少要 ${people * min} 元（每人 ${min} 元），總預算 ${budget} 元不夠。` };
    }
    const used = new Set(o.avoid || []);
    const orders = [];
    let remaining = budget;
    for (let i = 0; i < people; i++) {
      const cap = remaining - (people - i - 1) * min;
      const ok = all.filter(c => c.total <= cap);
      const fresh = ok.filter(c => !used.has(c.key));
      const pool = fresh.length ? fresh : ok;
      const combo = withExtras(pool[pickIndex(rng, pool.length)], o.extras, rng);
      used.add(combo.key);
      orders.push(combo);
      remaining -= combo.total;
    }
    const total = orders.reduce((s, c) => s + c.total, 0);
    return { ok: true, mode, orders, total, budget, remaining: budget === Infinity ? Infinity : budget - total, summary: summarize(orders) };
  }

  /** 叫餐彙總：同一品項合併數量（飲料甜度冰塊不同算不同杯） */
  function summarize(orders) {
    const map = new Map();
    orders.forEach(c => {
      [c.main, c.drink].forEach(it => {
        if (!it) return;
        const ex = it.drink && c.extras ? Object.values(c.extras).join('、') : '';
        const label = it.name + (ex ? `（${ex}）` : '');
        const row = map.get(label) || { name: label, price: it.price, qty: 0, subtotal: 0 };
        row.qty++; row.subtotal += it.price;
        map.set(label, row);
      });
    });
    return Array.from(map.values());
  }

  // ---------- 文字 ----------
  function money(n, unit) { return n === Infinity ? '不限' : `${n} ${unit || '元'}`; }
  function itemLine(it, extras) {
    const ex = extras ? Object.values(extras).join('、') : '';
    return `${it.name} ${it.price}${ex ? `（${ex}）` : ''}`;
  }
  function comboText(c) {
    return [c.main ? itemLine(c.main) : '', c.drink ? itemLine(c.drink, c.extras) : ''].filter(Boolean).join(' ＋ ');
  }
  function shopLines(shop) {
    const s = shop || {};
    const out = [];
    if (s.phone) out.push(`電話：${s.phone}`);
    if (s.address) out.push(`地址：${s.address}`);
    return out;
  }
  /** 單人結果 → 可以直接貼到 LINE 的文字 */
  function formatCombo(combo, shop, unit) {
    const s = shop || {};
    const lines = [`【今天吃什麼】${s.name || ''}`.trim()];
    if (combo.main) lines.push(`主餐：${combo.main.name} ${money(combo.main.price, unit)}`);
    if (combo.drink) {
      const ex = combo.extras ? Object.values(combo.extras).join('、') : '';
      lines.push(`飲料：${combo.drink.name}${ex ? `（${ex}）` : ''} ${money(combo.drink.price, unit)}`);
    }
    lines.push(`合計：${money(combo.total, unit)}`);
    return lines.concat(shopLines(s)).join('\n');
  }
  /** 團體訂單 → 文字（每人明細＋叫餐彙總） */
  function formatGroup(res, shop, unit) {
    const s = shop || {};
    const lines = [`【團體訂餐】${s.name || ''}　共 ${res.orders.length} 人`];
    res.orders.forEach((c, i) => lines.push(`${i + 1}. ${comboText(c)} ＝ ${c.total}`));
    lines.push('', '— 叫餐彙總 —');
    res.summary.forEach(r => lines.push(`${r.name} ×${r.qty}　${r.subtotal}`));
    lines.push('', `合計：${money(res.total, unit)}` + (res.budget === Infinity ? '' : `（預算 ${res.budget}，剩 ${res.remaining}）`));
    return lines.concat(shopLines(s)).join('\n');
  }

  // ---------- 其他 ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /** 用地址做 Google 地圖連結（只是開新分頁的連結，不呼叫 API） */
  function mapsLink(address) {
    const a = String(address || '').trim();
    return a ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a) : '';
  }
  /** 收藏／最近選擇存的是「快照」，菜單改了也看得懂 */
  function snapshot(combo, at) {
    return {
      key: combo.key,
      text: comboText(combo),
      total: combo.total,
      main: combo.main ? combo.main.name : '',
      drink: combo.drink ? combo.drink.name : '',
      extras: combo.extras || null,
      at: at || 0,
    };
  }
  function pushRecent(list, snap, max) {
    const out = [snap].concat((list || []).filter(x => x && x.at !== snap.at));
    return out.slice(0, Math.max(1, max || 10));
  }
  function toggleFavorite(list, snap) {
    const l = list || [];
    const sig = x => x.key + '|' + JSON.stringify(x.extras || null);
    return l.some(x => sig(x) === sig(snap)) ? l.filter(x => sig(x) !== sig(snap)) : [snap].concat(l);
  }
  /** 把收藏的快照換回目前菜單裡的品項（品名對得上才算） */
  function comboFromSnapshot(items, snap) {
    const find = (name, drink) => name ? items.find(i => i.name === name && i.drink === drink) : null;
    const main = find(snap.main, false), drink = find(snap.drink, true);
    if ((snap.main && !main) || (snap.drink && !drink)) return null;
    const c = comboOf(main, drink);
    return snap.extras ? Object.assign(c, { extras: snap.extras }) : c;
  }

  return {
    makeRng, detectDelimiter, parseCSV, loadCSV, splitTags, parsePrice, normalizeItem, buildMenu, parseMenuText,
    loadPresets, menuToJSON, menuToCSV, menuFacets, parseBudget, filterItems, isExcluded, candidates, pickCombo,
    pickGroup, summarize, comboText, formatCombo, formatGroup, escapeHtml, mapsLink, snapshot, pushRecent,
    toggleFavorite, comboFromSnapshot, COLUMNS,
  };
});
