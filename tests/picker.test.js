// 執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../js/picker.js');

const root = path.join(__dirname, '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(root, 'data', 'menus.js'), 'utf8'), ctx);
const CFG = ctx.window.PICKER_CONFIG;
const presets = P.loadPresets(ctx.window.MENUS);
const menuOf = id => presets.find(p => p.id === id).menu;
const breakfast = menuOf('breakfast');
const bento = menuOf('bento');
const drinks = menuOf('drinks');
const csv = fs.readFileSync(path.join(root, 'data', 'menu.example.csv'), 'utf8');

test('三份預設菜單都載得進來、沒有錯誤，設定檔的預設菜單存在', () => {
  assert.deepEqual(presets.map(p => p.id), ['breakfast', 'bento', 'drinks']);
  for (const p of presets) {
    assert.deepEqual(p.errors, [], p.id);
    assert.deepEqual(p.warnings, [], p.id);
    assert.ok(p.menu.items.length >= 10, p.id);
    assert.ok(/^示範/.test(p.name), p.id);
  }
  assert.ok(presets.some(p => p.id === CFG.defaultMenu));
  assert.ok(breakfast.items.some(i => i.drink) && breakfast.items.some(i => !i.drink));
  assert.ok(drinks.items.every(i => i.drink));
});

test('範本 CSV 和內建「示範早餐店」內容相同（含 BOM、CRLF）', () => {
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('\r\n'));
  const r = P.parseMenuText(csv, { id: 'breakfast', name: '示範早餐店' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.menu.items, breakfast.items);
  assert.equal(P.menuToCSV(breakfast), csv);
});

test('預算上限：固定種子跑 1000 次，從來不超過預算', () => {
  for (const m of presets.map(p => p.menu)) {
    const rng = P.makeRng(42);
    for (let i = 0; i < 1000; i++) {
      const budget = 15 + Math.floor(rng() * 150);
      const r = P.pickCombo(m.items, { budget, rng, extras: m.extras });
      if (r.ok) {
        assert.ok(r.combo.total <= budget, `${m.id} ${r.combo.total} > ${budget}`);
        assert.equal(r.combo.total, (r.combo.main ? r.combo.main.price : 0) + (r.combo.drink ? r.combo.drink.price : 0));
      } else assert.match(r.message, /預算/);
    }
  }
});

test('同一個種子結果完全一樣（可重現），不同種子會不一樣', () => {
  const run = seed => {
    const rng = P.makeRng(seed);
    return Array.from({ length: 20 }, () => P.pickCombo(breakfast.items, { rng }).combo.key);
  };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(8));
  const rng = P.makeRng(1);
  for (let i = 0; i < 1000; i++) { const x = rng(); assert.ok(x >= 0 && x < 1); }
});

test('剛好等於預算可以抽到；預算不夠時給清楚的訊息', () => {
  const r = P.pickCombo(breakfast.items, { budget: 45, mode: 'combo', rng: P.makeRng(3) });
  assert.ok(r.ok);
  assert.ok(r.combo.total <= 45);
  // 最便宜的組合 25（薯餅）+ 20 = 45：預算 45 只剩那幾組
  const all = P.candidates(...Object.values(P.filterItems(breakfast.items, {})), 'combo', 45);
  assert.ok(all.every(c => c.total === 45));
  const no = P.pickCombo(breakfast.items, { budget: 44, mode: 'combo', rng: P.makeRng(3) });
  assert.equal(no.ok, false);
  assert.match(no.message, /44.*45/);
  const zero = P.pickCombo(breakfast.items, { budget: 0, rng: P.makeRng(3) });
  assert.equal(zero.ok, false);
});

test('篩選：類別、飲料類型、不要的食材（標籤或品名）', () => {
  const rng = P.makeRng(11);
  for (let i = 0; i < 200; i++) {
    const r = P.pickCombo(breakfast.items, { categories: ['蛋餅'], drinkTypes: ['豆漿'], exclude: '豬、花生', rng });
    assert.ok(r.ok);
    assert.equal(r.combo.main.category, '蛋餅');
    assert.equal(r.combo.drink.drinkType, '豆漿');
    assert.ok(!r.combo.main.tags.includes('豬'));
    assert.notEqual(r.combo.drink.name, '米漿');
  }
  const f = P.filterItems(breakfast.items, { exclude: ['蛋餅'] });
  assert.ok(f.mains.every(i => !i.name.includes('蛋餅')));
  const nut = P.filterItems(breakfast.items, { exclude: '花生' });
  assert.ok([...nut.mains, ...nut.drinks].every(i => !i.tags.includes('花生')));
});

test('模式：只要主餐、只要飲料；飲料店自動變成只抽飲料，並附上甜度冰塊', () => {
  const rng = P.makeRng(5);
  const m = P.pickCombo(breakfast.items, { mode: 'main', rng });
  assert.ok(m.combo.main && !m.combo.drink);
  const d = P.pickCombo(breakfast.items, { mode: 'drink', rng });
  assert.ok(!d.combo.main && d.combo.drink);
  const auto = P.pickCombo(drinks.items, { rng, extras: drinks.extras });
  assert.equal(auto.mode, 'drink');
  assert.ok(drinks.extras.甜度.includes(auto.combo.extras.甜度));
  assert.ok(drinks.extras.冰塊.includes(auto.combo.extras.冰塊));
  assert.equal(P.pickCombo(bento.items, { rng }).mode, 'combo');
});

test('不重複：避開最近 3 次抽過的組合', () => {
  const rng = P.makeRng(99);
  const recent = [];
  for (let i = 0; i < 300; i++) {
    const r = P.pickCombo(bento.items, { budget: 120, rng, avoid: recent.slice(0, 3) });
    assert.ok(r.ok);
    assert.ok(!recent.slice(0, 3).includes(r.combo.key), `第 ${i} 次重複`);
    assert.equal(r.repeated, false);
    recent.unshift(r.combo.key);
  }
});

test('不重複：可選的太少時放寬並標記 repeated，不會卡住', () => {
  const items = P.buildMenu([{ 品名: 'A', 價格: 10 }, { 品名: 'B', 價格: 10 }]).menu.items;
  const rng = P.makeRng(1);
  const a = P.pickCombo(items, { mode: 'main', avoid: ['i1+-'], rng });
  assert.equal(a.combo.main.name, 'B');
  const b = P.pickCombo(items, { mode: 'main', avoid: ['i1+-', 'i2+-'], rng });
  assert.ok(b.ok);
  assert.equal(b.repeated, true);
});

test('不可能的條件：篩到沒有主餐或沒有飲料時給訊息，不丟錯', () => {
  const noMain = P.pickCombo(breakfast.items, { mode: 'combo', categories: ['不存在的類別'], rng: P.makeRng(1) });
  assert.equal(noMain.ok, false);
  assert.match(noMain.message, /主餐/);
  const noDrink = P.pickCombo(breakfast.items, { mode: 'combo', drinkTypes: ['酒'], rng: P.makeRng(1) });
  assert.equal(noDrink.ok, false);
  assert.match(noDrink.message, /飲料/);
  const shopOnlyDrinks = P.pickCombo(drinks.items, { mode: 'combo', rng: P.makeRng(1) });
  assert.equal(shopOnlyDrinks.ok, false);
  assert.equal(P.pickCombo([], {}).ok, false);
  assert.equal(P.pickGroup(breakfast.items, { people: 0 }).ok, false);
});

test('團體訂餐：總價永遠不超過預算，人數正確，彙總數量對得上', () => {
  const rng = P.makeRng(2026);
  for (let i = 0; i < 300; i++) {
    const people = 1 + Math.floor(rng() * 12);
    const budget = people * (100 + Math.floor(rng() * 60));
    const r = P.pickGroup(bento.items, { people, budget, rng });
    assert.ok(r.ok, r.message);
    assert.equal(r.orders.length, people);
    assert.ok(r.total <= budget, `${r.total} > ${budget}`);
    assert.equal(r.total, r.orders.reduce((s, c) => s + c.total, 0));
    assert.equal(r.remaining, budget - r.total);
    const qty = r.summary.reduce((s, x) => s + x.qty, 0);
    assert.equal(qty, r.orders.reduce((s, c) => s + (c.main ? 1 : 0) + (c.drink ? 1 : 0), 0));
    assert.equal(r.summary.reduce((s, x) => s + x.subtotal, 0), r.total);
  }
});

test('團體訂餐：每人上限、剛好夠、預算不夠', () => {
  const rng = P.makeRng(8);
  const r = P.pickGroup(bento.items, { people: 6, perPerson: 110, rng });
  assert.ok(r.ok);
  assert.ok(r.orders.every(c => c.total <= 110));
  assert.equal(r.remaining, Infinity);
  // 最便宜：肉燥飯／雞肉飯 45 + 味噌湯 15 = 60
  const tight = P.pickGroup(bento.items, { people: 5, budget: 300, rng });
  assert.ok(tight.ok);
  assert.ok(tight.orders.every(c => c.total === 60));
  const no = P.pickGroup(bento.items, { people: 5, budget: 299, rng });
  assert.equal(no.ok, false);
  assert.match(no.message, /5 人最少要 300 元/);
  const office = P.pickGroup(drinks.items, { people: 10, budget: 500, rng, extras: drinks.extras });
  assert.ok(office.ok && office.total <= 500 && office.orders.every(c => c.extras));
});

test('團體訂餐：選擇夠多時盡量每個人不一樣', () => {
  const r = P.pickGroup(bento.items, { people: 8, rng: P.makeRng(4) });
  assert.equal(new Set(r.orders.map(c => c.key)).size, 8);
});

test('CSV：BOM、引號、逗號、雙引號跳脫、Excel 貼上的 Tab、空白列', () => {
  const text = '﻿類別,品名,價格,標籤,是否飲料\r\n"吐司","起司,火腿吐司",40,"蛋、豬",否\r\n\r\n飲料,"""特調""奶茶",35,奶,是\r\n';
  const r = P.parseMenuText(text, { name: '測試' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.menu.items.length, 2);
  assert.equal(r.menu.items[0].name, '起司,火腿吐司');
  assert.deepEqual(r.menu.items[0].tags, ['蛋', '豬']);
  assert.equal(r.menu.items[1].name, '"特調"奶茶');
  assert.equal(r.menu.items[1].drink, true);
  const tsv = '類別\t品名\t價格\t是否飲料\t飲料類型\n蛋餅\t原味蛋餅\t30\t否\t\n飲料\t紅茶\tNT$20\t是\t茶\n';
  assert.equal(P.detectDelimiter(tsv), '\t');
  const t = P.parseMenuText(tsv);
  assert.deepEqual(t.menu.items.map(i => [i.name, i.price, i.drink, i.drinkType]), [['原味蛋餅', 30, false, ''], ['紅茶', 20, true, '茶']]);
  assert.equal(P.parseCSV('a,b\n"x\ny",2').length, 2);
});

test('匯入檢查：壞掉的列略過並說明，缺必要欄位直接擋下', () => {
  const r = P.parseMenuText('品名,價格\n好的,30\n,20\n壞價格,abc\n負的,-5\n小數,10.5\n好的,30\n');
  assert.equal(r.menu.items.length, 2);
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors.some(e => e.includes('沒有品名')));
  assert.ok(r.errors.some(e => e.includes('壞價格')));
  assert.ok(r.warnings.some(w => w.includes('重複')));
  assert.equal(P.parseMenuText('名字,錢\nA,1').menu, null);
  assert.equal(P.parseMenuText('').menu, null);
  assert.equal(P.parseMenuText('{壞掉').menu, null);
  // 沒填「是否飲料」時，看類別判斷
  const g = P.parseMenuText('類別,品名,價格\n飲品,豆漿,20\n蛋餅,原味,30');
  assert.deepEqual(g.menu.items.map(i => i.drink), [true, false]);
});

test('JSON 匯出再匯入，品項完全一樣（含 extras、shop）', () => {
  const back = P.parseMenuText(P.menuToJSON(drinks), { id: 'drinks' });
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.menu.items, drinks.items);
  assert.deepEqual(back.menu.extras, JSON.parse(JSON.stringify(drinks.extras)));
  assert.deepEqual(back.menu.shop, JSON.parse(JSON.stringify(drinks.shop)));
  assert.equal(back.menu.name, '示範飲料店');
  const arr = P.parseMenuText(JSON.stringify([{ name: 'X', price: 10, drink: true, drinkType: '茶' }]));
  assert.equal(arr.menu.items[0].drink, true);
});

test('分享文字：單人與團體格式，含店名、電話、合計', () => {
  const shop = Object.assign({}, CFG.shop);
  const r = P.pickCombo(breakfast.items, { mode: 'combo', budget: 80, rng: P.makeRng(10) });
  const t = P.formatCombo(r.combo, shop);
  assert.match(t, /^【今天吃什麼】示範早餐店/);
  assert.ok(t.includes(`主餐：${r.combo.main.name}`));
  assert.ok(t.includes(`合計：${r.combo.total} 元`));
  assert.ok(t.includes('電話：0900-000-001'));
  const g = P.pickGroup(bento.items, { people: 3, budget: 400, rng: P.makeRng(10) });
  const gt = P.formatGroup(g, bento.shop);
  assert.match(gt, /共 3 人/);
  assert.ok(gt.includes('叫餐彙總'));
  assert.ok(gt.includes(`合計：${g.total} 元（預算 400，剩 ${400 - g.total}）`));
});

test('收藏、最近選擇、快照還原', () => {
  const r = P.pickCombo(drinks.items, { rng: P.makeRng(3), extras: drinks.extras });
  const s = P.snapshot(r.combo, 1);
  let fav = P.toggleFavorite([], s);
  assert.equal(fav.length, 1);
  fav = P.toggleFavorite(fav, P.snapshot(r.combo, 2));
  assert.equal(fav.length, 0);
  let recent = [];
  for (let i = 1; i <= 15; i++) recent = P.pushRecent(recent, Object.assign({}, s, { at: i }), 10);
  assert.equal(recent.length, 10);
  assert.equal(recent[0].at, 15);
  const back = P.comboFromSnapshot(drinks.items, s);
  assert.equal(back.key, r.combo.key);
  assert.deepEqual(back.extras, r.combo.extras);
  assert.equal(P.comboFromSnapshot(breakfast.items, Object.assign({}, s, { drink: '不存在' })), null);
});

test('跳脫 HTML、Google 地圖連結、預算解析', () => {
  assert.equal(P.escapeHtml('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(P.mapsLink(''), '');
  assert.equal(P.mapsLink(' 示範路 1 號 '), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('示範路 1 號'));
  assert.equal(P.parseBudget(''), Infinity);
  assert.equal(P.parseBudget('120'), 120);
  assert.equal(P.parseBudget('NT$1,200'), 1200);
  assert.equal(P.parseBudget('abc'), Infinity);
});

test('資料檔沒有真實店家資料：沒有 email、只有 0900-000-00x 示範電話（和作者聯絡電話）', () => {
  const files = ['index.html', 'config.js', 'README.md', 'NOTICE', 'data/menus.js', 'data/menu.example.csv',
    'js/picker.js', 'js/app.js', 'css/style.css', 'docs/金鑰申請.md'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), `${f} 含有 email`);
    for (const m of text.match(/0\d[\d-]{7,11}\d/g) || []) {
      assert.match(m, /^(0900-000-00\d|0928-880-392)$/, `${f} 含有電話 ${m}`);   // 只允許示範電話與作者公開的聯絡電話
    }
  }
});
