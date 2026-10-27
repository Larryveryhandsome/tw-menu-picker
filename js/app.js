/* tw-menu-picker 畫面邏輯。抽選、篩選、文字格式都在 picker.js。 */
(function () {
  'use strict';
  const P = window.Picker;
  const CFG = window.PICKER_CONFIG || {};
  const UNIT = CFG.currency || '元';
  const KEY = 'tw-menu-picker:v1';
  const $ = id => document.getElementById(id);
  const esc = P.escapeHtml;

  // ---------- 儲存（不能存也照常運作） ----------
  let saved = {};
  let canStore = true;
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; canStore = false; }
  if (!saved || typeof saved !== 'object') saved = {};
  saved.data = saved.data && typeof saved.data === 'object' ? saved.data : {};
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { canStore = false; $('storageMsg').hidden = false; }
  }
  function bucket() {
    const b = saved.data[menuId] || (saved.data[menuId] = {});
    if (!Array.isArray(b.fav)) b.fav = [];
    if (!Array.isArray(b.recent)) b.recent = [];
    return b;
  }

  // ---------- 菜單 ----------
  const menus = new Map();
  P.loadPresets(window.MENUS).forEach(p => {
    if (p.menu) menus.set(p.id, p.menu);
    else if (window.console) console.warn('菜單「' + p.name + '」有錯：', p.errors);
  });
  function loadCustom() {
    if (!saved.custom) return;
    const r = P.parseMenuText(saved.custom, { id: 'custom' });
    if (r.menu) menus.set('custom', r.menu);
  }
  loadCustom();

  let menuId = menus.has(saved.menuId) ? saved.menuId : (menus.has(CFG.defaultMenu) ? CFG.defaultMenu : menus.keys().next().value);
  let menu = menus.get(menuId);
  let groupMode = false;
  let current = null; // 目前顯示的單人組合

  function shopOf(m) {
    if (!m) return Object.assign({}, CFG.shop);
    if (m.id === 'custom') return Object.assign({}, CFG.shop, { name: m.name }, m.shop);
    return Object.assign({}, CFG.shop, m.shop);
  }

  function fillMenuSelect() {
    $('menuSelect').innerHTML = Array.from(menus.values()).map(m =>
      `<option value="${esc(m.id)}"${m.id === menuId ? ' selected' : ''}>${esc(m.id === 'custom' ? '我的菜單：' + m.name : m.name)}</option>`).join('');
    $('btnRemoveCustom').hidden = !menus.has('custom');
  }

  function renderShop() {
    const s = shopOf(menu);
    document.title = (CFG.title || '今天吃什麼？') + (s.name ? '｜' + s.name : '');
    $('title').textContent = CFG.title || '今天吃什麼？';
    $('shopName').textContent = s.name || '';
    const bits = [];
    if (s.hours) bits.push(`<span>${esc(s.hours)}</span>`);
    if (s.phone) bits.push(`<span>電話 <a href="tel:${esc(String(s.phone).replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a></span>`);
    const link = P.mapsLink(s.address);
    if (link) bits.push(`<span>${esc(s.address)}（<a href="${esc(link)}" target="_blank" rel="noopener">Google 地圖</a>）</span>`);
    $('shopInfo').innerHTML = bits.join('');
    $('footNote').textContent = s.note || '價格與品項原則上以店家現場為準。';
  }

  function chip(name, value) {
    return `<label class="chip"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"><span>${esc(value)}</span></label>`;
  }
  function renderFilters() {
    const f = P.menuFacets(menu.items);
    $('cats').innerHTML = f.categories.map(c => chip('cat', c)).join('');
    $('types').innerHTML = f.drinkTypes.map(c => chip('type', c)).join('');
    $('tags').innerHTML = f.tags.map(c => chip('tag', c)).join('');
    $('tags').closest('fieldset').classList.add('exclude');
    updateBoxes();
  }
  function updateBoxes() {
    const f = P.menuFacets(menu.items);
    const mode = $('mode').value;
    $('catBox').hidden = !f.categories.length || mode === 'drink';
    $('typeBox').hidden = !f.drinkTypes.length || mode === 'main';
  }
  function checked(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
  }
  function filters() {
    return {
      mode: $('mode').value,
      categories: $('catBox').hidden ? [] : checked('cat'),
      drinkTypes: $('typeBox').hidden ? [] : checked('type'),
      exclude: checked('tag').concat(P.splitTags($('excludeText').value)),
      budget: $('budget').value,
      extras: menu.extras,
    };
  }

  function renderMenuView() {
    const byCat = new Map();
    menu.items.forEach(i => {
      const k = i.category;
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k).push(i);
    });
    $('menuView').innerHTML = Array.from(byCat.entries()).map(([cat, list]) =>
      `<div class="menu-cat">${esc(cat)}</div><ul class="menu-items">` + list.map(i =>
        `<li><span>${esc(i.name)}${i.tags.length ? ` <span class="tags">${esc(i.tags.join('、'))}</span>` : ''}</span><span>${i.price}</span></li>`).join('') + '</ul>').join('');
  }

  // ---------- 結果 ----------
  function money(n) { return n === Infinity ? '不限' : `${n} ${UNIT}`; }
  function showMessage(text) {
    current = null;
    const r = $('result');
    r.hidden = false;
    r.innerHTML = `<h2>選不出來</h2><p>${esc(text)}</p>`;
  }
  function isFav(combo) {
    const s = P.snapshot(combo);
    return bucket().fav.some(x => x.key === s.key && JSON.stringify(x.extras || null) === JSON.stringify(s.extras || null));
  }
  function extrasText(c) { return c.extras ? Object.values(c.extras).join('、') : ''; }

  function renderSolo(combo, info) {
    current = combo;
    const budget = P.parseBudget($('budget').value);
    const title = [combo.main && combo.main.name, combo.drink && combo.drink.name].filter(Boolean).join(' ＋ ');
    let rows = '';
    if (combo.main) rows += `<tr><td class="kind">主餐</td><td>${esc(combo.main.name)}</td><td class="num">${money(combo.main.price)}</td></tr>`;
    if (combo.drink) {
      const ex = extrasText(combo);
      rows += `<tr><td class="kind">飲料</td><td>${esc(combo.drink.name)}${ex ? `<div class="extras">${esc(ex)}</div>` : ''}</td><td class="num">${money(combo.drink.price)}</td></tr>`;
    }
    rows += `<tr class="sum"><td class="kind">合計</td><td></td><td class="num">${money(combo.total)}</td></tr>`;
    const notes = [];
    if (budget !== Infinity) notes.push(`預算 ${budget}，還剩 ${budget - combo.total} ${UNIT}`);
    if (info && info.poolSize) notes.push(`從 ${info.poolSize} 種組合抽出`);
    $('result').hidden = false;
    $('result').innerHTML =
      `<h2>${esc(title)}</h2>` +
      `<table class="breakdown">${rows}</table>` +
      (notes.length ? `<p class="hint">${esc(notes.join('｜'))}</p>` : '') +
      (info && info.repeated ? '<p class="repeat">符合條件的組合太少，和最近抽過的重複了。</p>' : '') +
      `<div class="actions">
        <button type="button" class="primary" data-act="again">再抽一次</button>
        <button type="button" data-act="fav">${isFav(combo) ? '★ 取消收藏' : '☆ 收藏'}</button>
        <button type="button" data-act="copy">複製文字（貼到 LINE）</button>
        ${navigator.share ? '<button type="button" data-act="share">分享</button>' : ''}
      </div><div id="copyMsg" class="hint" aria-live="polite"></div>`;
  }

  let lastGroup = null;
  function renderGroup(res) {
    lastGroup = res;
    current = null;
    const rows = res.orders.map((c, i) => {
      const ex = extrasText(c);
      const what = [c.main && esc(c.main.name), c.drink && esc(c.drink.name) + (ex ? `<span class="extras">（${esc(ex)}）</span>` : '')].filter(Boolean).join(' ＋ ');
      return `<tr><td class="kind">${i + 1}</td><td>${what}</td><td class="num">${money(c.total)}</td></tr>`;
    }).join('');
    const sum = res.summary.map(r => `<tr><td class="kind">×${r.qty}</td><td>${esc(r.name)}</td><td class="num">${money(r.subtotal)}</td></tr>`).join('');
    const avg = Math.round(res.total / res.orders.length);
    $('result').hidden = false;
    $('result').innerHTML =
      `<h2>${res.orders.length} 人份，合計 ${money(res.total)}</h2>` +
      `<p class="hint">${res.budget === Infinity ? '' : `預算 ${res.budget}，還剩 ${res.remaining} ${UNIT}｜`}平均每人約 ${avg} ${UNIT}</p>` +
      `<table class="breakdown">${rows}</table>` +
      `<h2>叫餐彙總</h2><table class="breakdown">${sum}<tr class="sum"><td class="kind">合計</td><td></td><td class="num">${money(res.total)}</td></tr></table>` +
      `<div class="actions">
        <button type="button" class="primary" data-act="again">再抽一次</button>
        <button type="button" data-act="copy">複製訂單（貼到 LINE）</button>
        ${navigator.share ? '<button type="button" data-act="share">分享</button>' : ''}
      </div><div id="copyMsg" class="hint" aria-live="polite"></div>`;
  }

  function pick() {
    const f = filters();
    if (groupMode) {
      const res = P.pickGroup(menu.items, Object.assign(f, { people: $('people').value, perPerson: $('perPerson').value }));
      if (!res.ok) return showMessage(res.message);
      renderGroup(res);
    } else {
      const avoid = bucket().recent.slice(0, Math.max(0, CFG.noRepeatLast == null ? 3 : CFG.noRepeatLast)).map(s => s.key);
      if (current) avoid.push(current.key);
      const res = P.pickCombo(menu.items, Object.assign(f, { avoid }));
      if (!res.ok) return showMessage(res.message);
      const b = bucket();
      b.recent = P.pushRecent(b.recent, P.snapshot(res.combo, Date.now()), CFG.historyMax || 10);
      store();
      renderSolo(res.combo, res);
      renderLists();
    }
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resultText() {
    const s = shopOf(menu);
    if (groupMode && lastGroup) return P.formatGroup(lastGroup, s, UNIT);
    if (current) return P.formatCombo(current, s, UNIT);
    return '';
  }
  function copyText(text) {
    const done = ok => { const m = $('copyMsg'); if (m) m.textContent = ok ? '已複製，可以貼到 LINE 了。' : '複製失敗，請手動選取。'; };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
    } else done(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed'; t.style.top = '-1000px';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    t.remove();
    return ok;
  }

  $('result').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'again') pick();
    else if (act === 'fav' && current) {
      const bk = bucket();
      bk.fav = P.toggleFavorite(bk.fav, P.snapshot(current, Date.now()));
      store();
      b.textContent = isFav(current) ? '★ 取消收藏' : '☆ 收藏';
      renderLists();
    } else if (act === 'copy') copyText(resultText());
    else if (act === 'share') navigator.share({ text: resultText() }).catch(() => {});
  });

  // ---------- 收藏／最近 ----------
  function listHtml(list, kind) {
    if (!list.length) return `<li class="empty">${kind === 'fav' ? '還沒有收藏，抽到喜歡的按「☆ 收藏」。' : '還沒有紀錄。'}</li>`;
    return list.map((s, i) => {
      const ex = s.extras ? `（${Object.values(s.extras).join('、')}）` : '';
      return `<li><span class="txt">${esc((s.main && s.drink ? s.main + ' ＋ ' + s.drink : s.main || s.drink) + ex)}</span>` +
        `<span class="price">${money(s.total)}</span>` +
        `<button type="button" data-kind="${kind}" data-i="${i}" data-do="show">選這個</button>` +
        (kind === 'fav' ? `<button type="button" data-kind="fav" data-i="${i}" data-do="del" aria-label="移除收藏">移除</button>` : '') + '</li>';
    }).join('');
  }
  function renderLists() {
    const b = bucket();
    $('favList').innerHTML = listHtml(b.fav, 'fav');
    $('recentList').innerHTML = listHtml(b.recent, 'recent');
    $('storageMsg').hidden = canStore;
  }
  function onListClick(e) {
    const btn = e.target.closest('button[data-do]');
    if (!btn) return;
    const b = bucket();
    const list = btn.dataset.kind === 'fav' ? b.fav : b.recent;
    const s = list[+btn.dataset.i];
    if (!s) return;
    if (btn.dataset.do === 'del') {
      b.fav = b.fav.filter(x => x !== s);
      store();
      renderLists();
      if (current) renderSolo(current);
      return;
    }
    const combo = P.comboFromSnapshot(menu.items, s);
    if (!combo) return showMessage('目前的菜單已經沒有這個品項了。');
    if (groupMode) setGroup(false);
    renderSolo(combo);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('favList').addEventListener('click', onListClick);
  $('recentList').addEventListener('click', onListClick);
  $('btnClearRecent').addEventListener('click', () => { bucket().recent = []; store(); renderLists(); });

  // ---------- 切換 ----------
  function setGroup(on) {
    groupMode = on;
    $('tabSolo').classList.toggle('active', !on);
    $('tabGroup').classList.toggle('active', on);
    $('tabSolo').setAttribute('aria-selected', String(!on));
    $('tabGroup').setAttribute('aria-selected', String(on));
    document.querySelectorAll('.group-only').forEach(el => { el.hidden = !on; });
    $('budgetLabel').textContent = on ? '全部人的總預算（元，空白＝不限）' : '總價上限（元，空白＝不限）';
    $('btnPick').textContent = on ? '幫大家選！' : '幫我選！';
    $('result').hidden = true;
    current = null; lastGroup = null;
  }
  $('tabSolo').addEventListener('click', () => setGroup(false));
  $('tabGroup').addEventListener('click', () => setGroup(true));
  $('mode').addEventListener('change', updateBoxes);
  $('btnPick').addEventListener('click', pick);

  function switchMenu(id) {
    if (!menus.has(id)) return;
    menuId = id;
    menu = menus.get(id);
    saved.menuId = id;
    store();
    current = null; lastGroup = null;
    $('result').hidden = true;
    $('btnPick').disabled = false;
    fillMenuSelect();
    renderShop();
    renderFilters();
    renderMenuView();
    renderLists();
  }
  $('menuSelect').addEventListener('change', e => switchMenu(e.target.value));

  // ---------- 匯入／匯出 ----------
  function importMsg(cls, html) {
    const m = $('importMsg');
    m.hidden = false;
    m.className = 'msg ' + cls;
    m.innerHTML = html;
  }
  function applyImport(text) {
    const name = $('importName').value.trim() || '我的菜單';
    const r = P.parseMenuText(text, { id: 'custom', name });
    const problems = r.errors.concat(r.warnings);
    if (!r.menu) return importMsg('err', '沒辦法套用：<ul>' + problems.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>');
    if (!r.menu.name || r.menu.name === '我的菜單') r.menu.name = name;
    r.menu.id = 'custom';
    menus.set('custom', r.menu);
    saved.custom = P.menuToJSON(r.menu);
    store();
    switchMenu('custom');
    importMsg('ok', `已套用「${esc(r.menu.name)}」，共 ${r.menu.items.length} 個品項。` +
      (problems.length ? '有些列被略過或需要注意：<ul>' + problems.slice(0, 20).map(p => `<li>${esc(p)}</li>`).join('') + '</ul>' : '') +
      (canStore ? '' : '（這個瀏覽器不能存資料，關掉網頁後要重新匯入）'));
  }
  $('btnImport').addEventListener('click', () => applyImport($('importText').value));
  $('importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result || '');
      if (text.includes('�')) {
        importMsg('err', '這個檔案看起來不是 UTF-8 編碼（中文會變亂碼）。請在 Excel 用「另存新檔 → CSV UTF-8（逗號分隔）」再試一次。');
        return;
      }
      if (!$('importName').value.trim()) $('importName').value = f.name.replace(/\.[^.]+$/, '');
      $('importText').value = text.replace(/^﻿/, '');
      applyImport(text);
    };
    rd.readAsText(f, 'utf-8');
    e.target.value = '';
  });
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('btnExportJson').addEventListener('click', () => download(`menu-${menu.id}.json`, P.menuToJSON(Object.assign({}, menu, { shop: menu.shop })), 'application/json'));
  $('btnExportCsv').addEventListener('click', () => download(`menu-${menu.id}.csv`, P.menuToCSV(menu), 'text/csv'));
  $('btnRemoveCustom').addEventListener('click', () => {
    if (!confirm('確定要刪除你匯入的菜單嗎？（內建的示範菜單不受影響）')) return;
    menus.delete('custom');
    delete saved.custom;
    delete saved.data.custom;
    store();
    switchMenu(menus.has(CFG.defaultMenu) ? CFG.defaultMenu : menus.keys().next().value);
    importMsg('ok', '已刪除。');
  });

  // ---------- 深色模式 ----------
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : !!(media && media.matches);
  }
  function applyTheme() {
    if (saved.theme === 'dark' || saved.theme === 'light') document.documentElement.setAttribute('data-theme', saved.theme);
    else document.documentElement.removeAttribute('data-theme');
    $('btnTheme').textContent = isDark() ? '淺色' : '深色';
  }
  $('btnTheme').addEventListener('click', () => { saved.theme = isDark() ? 'light' : 'dark'; store(); applyTheme(); });
  if (media && media.addEventListener) media.addEventListener('change', applyTheme);

  // ---------- 開始 ----------
  applyTheme();
  $('budget').value = CFG.defaultBudget == null ? '' : CFG.defaultBudget;
  $('people').value = CFG.defaultPeople || 5;
  if (!menu) {
    $('btnPick').disabled = true;
    showMessage('找不到任何菜單，請檢查 data/menus.js，或在下方「換成我的菜單」貼上你的菜單。');
    fillMenuSelect();
    return;
  }
  switchMenu(menuId);
})();
