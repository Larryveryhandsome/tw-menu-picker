# RELEASE_CHECK｜tw-menu-picker

檢查日期：2026-10-24　檢查版本：6fa11ee（含本次 README 修正）（從 GitHub 乾淨 clone）　依據：release-quality-gate 八道閘門（低風險純靜態網站，深度依風險調整）

## 結論

**目前的檔案可以公開（七道 ✅／⚠️ 皆無阻斷）。第 7 道 ⚠️：git 歷史（1 個 commit）的 README 含本人姓名，需全新歷史（要店長同意 force push 或重建 repo）才完全符合 10/24 新規則。**

## 八道閘門

| # | 閘門 | 結果 | 證據 |
|---|---|---|---|
| 1 | 需求與設計 | ✅ | README 寫明用途、適合誰、資料只存在自己瀏覽器、需不需要金鑰（不需要）、已知限制。 |
| 2 | 程式本身 | ✅ | `npm test`：20 項全過（乾淨 clone，免安裝套件，無第三方相依）。沒有跑靜態分析工具。 |
| 3 | 串接 | ✅ | 沒有後端、沒有外部 API；只有公開連結（LINE 官方帳號、GitHub）。 |
| 4 | 完成使用者任務 | ✅ | Playwright 桌機＋375px：單人抽餐有結果（品項＋價格＋合計）、團體訂餐（5 人，合計與平均每人）、預算低到湊不出來時不當機、頁面按鈕（31 次）全點過，console 無錯誤、無橫向捲動。 |
| 5 | 安全／效能／環境 | ⚠️ | 無後端、無個資；`escapeHtml` 有單元測試；示範電話為 0900-000-xxx 假號碼。 只測 Chromium，Firefox／Safari 未測；真手機實測未做。 |
| 6 | 資料 | ⚠️ | 自訂菜單存在瀏覽器；有「匯出 JSON／CSV」可備份，單元測試「JSON 匯出再匯入，品項完全一樣」通過；在瀏覽器用檔案選擇器實際還原一次沒實測。 |
| 7 | 交付版本 | ⚠️ | 測的版本＝發布版本（6fa11ee（含本次 README 修正） 乾淨 clone）。已新增 GitHub Actions（`.github/workflows/test.yml`，每次 push 自動跑 `npm test`）。git 歷史只有 1 個 commit，作者是 noreply 信箱；但這個 commit 的 README 作者行含本人姓名（deep_audit 報告 `_統籌/gate_C/audit_tw-menu-picker.md`）。現有檔案已在本次 commit 改掉，歷史裡還在。依 10/24 新規則需全新歷史（要店長同意 force push 或重建 repo）；本次未改寫歷史。 |
| 8 | 出事能恢復 | ✅ | 靜態網站：出錯用 `git revert` 重新部署，Pages 數分鐘生效；發布後確認 Pages 回 200。沒有資料庫變更。 |

## 測試環境與範圍

- 乾淨 clone：`git clone https://github.com/Larryveryhandsome/tw-menu-picker.git`（暫存路徑），不裝任何套件。
- 瀏覽器：Playwright Chromium，桌機 1280px 與手機 375px 各跑一次。**只測 Chromium**，Firefox／Safari 沒測。
- 沒有後端、沒有金流、沒有登入、沒有串接外部服務（除了下面各項註明的公開連結），所以串接、越權、金流類測試不適用。

## 已知問題與限制

- 內建菜單、店名、電話全是虛構示範資料（電話 0900-000-001～003）。
- 用檔案選擇器匯入 CSV／JSON 沒在瀏覽器實測（單元測試有涵蓋解析）。
- 價格與過敏原以店家現場為準。
- git 歷史未清（見第 7 道）。

## 發布決定

現有檔案：可以公開（已是公開狀態）。歷史：需店長決定是否全新歷史。
