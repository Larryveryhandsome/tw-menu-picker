/*
 * tw-menu-picker 設定檔（用記事本打開改就好，改完重新整理網頁）
 * 示範內容全部是虛構的。
 */
window.PICKER_CONFIG = {
  // 網頁標題
  title: '今天吃什麼？',

  // 店家資訊（沒有自己 shop 的菜單會用這組）
  shop: {
    name: '示範早餐店',
    address: '',            // 有填才會出現「Google 地圖」連結，例如：'○○市○○路 1 號'
    phone: '0900-000-001',  // 可留空
    hours: '每天 06:00–12:30（示範）',
    note: '價格與品項原則上以店家現場為準。',
  },

  // 打開網頁時先顯示哪一份菜單（data/menus.js 裡的 id）
  defaultMenu: 'breakfast',

  // 最近 N 次抽過的組合盡量不要再抽到（菜單太小時會自動放寬）
  noRepeatLast: 3,

  // 「最近選擇」保留幾筆
  historyMax: 10,

  // 預設預算（空字串＝不限）
  defaultBudget: '',

  // 團體訂餐預設人數
  defaultPeople: 5,

  // 金額單位
  currency: '元',
};
