# UnfairSpinWheel（leafwind fork）

這是 UnfairSpinWheel 的 fork，客製成消費 oripyon 服務的抖內即時串流，用抖內驅動轉盤。
上游是 jim60105/UnfairSpinWheel；此 fork 額外加的只有「抖內即時觸發」這條整合。

## 抖內整合（消費端契約）

此 repo 是消費端；契約的權威在 oripyon（resolve endpoint、broadcast、CORS 都在那，
改動也從那發生）。這裡記的是「在本 repo 工作需要知道的、對方保證的形狀」。

連線流程（見 `src/components/SpinWheel.vue` 的 `connectDonationRealtime`）：

1. UUID 來源：網址最後一段的路徑（`src/main.ts` 解析後以 `provide('uuid', ...)` 注入）。
   UUID 是唯一的 per-streamer 輸入，也是存取秘密；本 repo 不保存任何金鑰。
2. 解析：載入時 `GET https://neoripyon.leafwind.tw/donations/resolve/<uuid>`，
   回傳 `{ twitch_channel_name, supabase_url, supabase_anon_key }`；未知 UUID 回 404
   （順便當 UUID 驗證）。Supabase 設定是 runtime 取得，不寫死在前端。
   anon key 是公開值，出現在前端無妨。
3. 訂閱：`createClient(supabase_url, supabase_anon_key)` 後訂閱 Supabase Realtime
   的 broadcast channel `donations:<uuid>`，監聽 `donation` 事件。重連由 supabase-js
   自帶，不要自己寫 retry。
4. 事件形狀：`msg.payload` 為 `{ type: "donation", data: { donate_id, name, amount,
   message, timestamp, platform } }`；取 `payload.data` 傳給 `handleDonation`。
5. 行為：每筆抖內轉 `floor(amount / 門檻)` 次。

## 安全模型（務必維持）

- donations channel 應為 private（`{ config: { private: true } }`），並搭配 oripyon 端
  的 Realtime Authorization（`realtime.messages` 的 RLS：擋 anon broadcast、只允
  service-role 發送）。兩者是一組，少一邊會導致「收不到」或「事件可被偽造」。
- 部署順序：先在 oripyon 建好 RLS policy，再部署帶 private 的前端；反過來會因
  deny-by-default 連接收都被拒。

## 對方（oripyon）端要點，僅供理解，不在本 repo 維護

- oripyon 對每個對到該頻道的 overlay uuid 各廣播一次到 `donations:<uuid>`（per-uuid，
  非以頻道名當 topic，以維持「不可猜秘密才收得到」）。

## 部署

部署在 leafwind 自己的 Vercel（`unfair-spin-wheel*.vercel.app`），oripyon 的 CORS
只放行這個來源打 `GET /donations/resolve/{uuid}`。正式站 `https://unfair.spin-wheel.click`。

## 輸出風格

- 文件用繁體中文（台灣）。
- 撰寫文件或程式檔案時不使用粗體強調（**text**）。
