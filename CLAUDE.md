# CLAUDE.md — EdoStock Legacy

## プロジェクト概要

EdoStock: 江戸一飯田の在庫管理システム。
食品・アパレル・雑貨を扱う小売店の仕入・売上・在庫・棚卸しを一元管理する。
React/Vite + Express/TypeScript + Prisma/SQLite 構成。Render (Web Service) にデプロイ。

本番URL: https://edostock.onrender.com

## 技術スタック

- **フロントエンド**: React 18, Vite 5, TypeScript, TailwindCSS, shadcn/ui (Radix UI), TanStack Query, React Router v6, Recharts, React Hook Form + Zod
- **バックエンド**: Express 5, TypeScript (tsx で直接実行), express-session (認証), multer (ファイルアップロード), node-cron (日次同期)
- **DB**: SQLite (Prisma ORM), ファイルベース
- **デプロイ**: Render (Web Service, Singapore リージョン, Starter プラン)
- **外部連携**: スマレジ POS API (販売データ自動同期)
- **テスト**: Vitest, Testing Library

## 本番環境の重要ルール (最重要)

- **DATABASE_URL**: `file:/opt/render/project/src/prisma/production.db` — **絶対パス必須**。相対パス (`file:./production.db`) にすると Render 上でDBが見つからなくなる
- **Persistent Disk マウントポイント**: `/opt/render/project/src/prisma/` (1GB)
- **`prisma db push` と `seed` は startCommand で実行すること** — buildCommand 実行時は persistent disk が未マウントのため、ビルド中にDB操作するとデータが消える
- render.yaml の構成:
  - `buildCommand`: `npm install --include=dev && npx vite build && npx prisma generate`
  - `startCommand`: `npx prisma db push && npx tsx prisma/seed.ts && NODE_ENV=production npx tsx server/index.ts`
- ローカル開発用DBは `dev.db`、本番は `production.db`。混同しないこと
- 環境変数: `NODE_VERSION=20`, `SESSION_SECRET` (自動生成), `NODE_ENV=production`

## ディレクトリ構成

```
edostock-legacy/
├── server/                  # バックエンド API
│   ├── index.ts             # Express アプリ起点、ルーティング、認証ミドルウェア
│   ├── auth.ts              # 認証 (login/logout/session)、ユーザーCRUD
│   ├── products.ts          # 商品CRUD、一括更新、SupplierProductMapping API
│   ├── inventory.ts         # 在庫一覧、アラート、入出庫登録
│   ├── csv.ts               # 売上CSV (Smaregi形式) インポート、月次売上インポート
│   ├── purchase-import.ts   # 仕入インポート (エトワール/コレック/ジャヌツー)
│   ├── analytics.ts         # ダッシュボード、ABC分析、季節分析、需要予測、発注推奨
│   ├── stocktakes.ts        # 棚卸し (開始→カウント入力→確定)
│   └── smaregi.ts           # スマレジAPI連携 (設定/接続テスト/同期/cron)
├── src/                     # フロントエンド React
│   ├── pages/               # ページコンポーネント
│   │   ├── Index.tsx         # ダッシュボード (/)
│   │   ├── Login.tsx         # ログイン (/login)
│   │   ├── Inventory.tsx     # 在庫一覧 (/inventory)
│   │   ├── CsvImport.tsx     # CSVインポート (/import)
│   │   ├── Alerts.tsx        # アラート (/alerts)
│   │   ├── Stocktake.tsx     # 棚卸し (/stocktake)
│   │   ├── AbcAnalysis.tsx   # ABC分析 (/analytics/abc)
│   │   ├── SeasonalAnalysis.tsx # 季節分析 (/analytics/seasonal)
│   │   ├── Forecast.tsx      # 需要予測 (/analytics/forecast)
│   │   ├── Recommendations.tsx # 発注推奨 (/analytics/recommendations)
│   │   ├── OptimalStock.tsx  # 適正在庫一覧 (/optimal-stock)
│   │   ├── ProductSettings.tsx # 商品設定 (/settings/products)
│   │   ├── UserSettings.tsx  # ユーザー管理 (/settings/users)
│   │   └── SmaregiSettings.tsx # スマレジ設定 (/settings/smaregi)
│   ├── components/
│   │   ├── layout/           # AppLayout (認証チェック + ナビゲーション)
│   │   ├── dashboard/        # ダッシュボード用コンポーネント
│   │   └── ui/               # shadcn/ui コンポーネント
│   └── hooks/                # カスタムフック
├── prisma/
│   ├── schema.prisma         # DBスキーマ定義
│   └── seed.ts               # 初期データ (カテゴリ + 管理者/スタッフユーザー)
├── sql/                      # 手動実行用SQL
├── render.yaml               # Render デプロイ設定
└── package.json
```

## APIエンドポイント

| パス | メソッド | 権限 | 概要 |
|------|----------|------|------|
| `/api/auth/login` | POST | - | ログイン (email + password) |
| `/api/auth/session` | GET | - | セッション確認 |
| `/api/auth/logout` | POST | - | ログアウト |
| `/api/auth/users` | GET/POST | ADMIN | ユーザー一覧/作成 |
| `/api/auth/users/:id` | PUT/DELETE | ADMIN | ユーザー編集/削除 |
| `/api/products` | GET/POST | AUTH/ADMIN | 商品一覧/新規作成 |
| `/api/products/bulk-update` | PUT | ADMIN | 商品一括更新 |
| `/api/products/bulk-stock` | PUT | ADMIN | 在庫一括設定 |
| `/api/products/:id` | PUT/DELETE | ADMIN | 商品編集/論理削除 |
| `/api/products/categories` | GET | AUTH | カテゴリ一覧 |
| `/api/inventory` | GET/POST | AUTH | 在庫一覧/入出庫登録 |
| `/api/inventory/alerts` | GET | AUTH | 在庫アラート |
| `/api/csv` | POST | ADMIN | 売上CSVインポート確定 |
| `/api/csv/preview` | POST | ADMIN | 売上CSVプレビュー |
| `/api/csv/history` | GET | ADMIN | インポート履歴 |
| `/api/purchase-import/etoile` | POST | ADMIN | エトワールCSVプレビュー |
| `/api/purchase-import/etoile/confirm` | POST | ADMIN | エトワール確定 |
| `/api/purchase-import/corec/parse` | POST | ADMIN | コレックPDF解析 |
| `/api/purchase-import/corec/confirm` | POST | ADMIN | コレック確定 |
| `/api/purchase-import/jannu/parse` | POST | ADMIN | ジャヌツーExcel解析 |
| `/api/purchase-import/jannu/confirm` | POST | ADMIN | ジャヌツー確定 |
| `/api/analytics/dashboard` | GET | AUTH | ダッシュボード集計 |
| `/api/analytics/abc` | GET | AUTH | ABC分析 |
| `/api/analytics/seasonal` | GET | AUTH | 季節分析 |
| `/api/analytics/forecast` | GET | AUTH | 需要予測 |
| `/api/analytics/recommendations` | GET | AUTH | 発注推奨 |
| `/api/stocktakes` | GET/POST | AUTH | 棚卸し一覧/開始 |
| `/api/stocktakes/:id` | GET | AUTH | 棚卸し詳細 |
| `/api/stocktakes/:id/counts/:productId` | PUT | AUTH | 実在庫入力 |
| `/api/stocktakes/:id/complete` | POST | AUTH | 棚卸し確定 |
| `/api/smaregi/config` | GET/POST | ADMIN | スマレジ設定 |
| `/api/smaregi/test` | POST | ADMIN | 接続テスト |
| `/api/smaregi/sync` | POST | ADMIN | 手動同期 |
| `/api/smaregi/sync-logs` | GET | ADMIN | 同期ログ |
| `/api/supplier-mappings` | GET | AUTH | マッピング一覧 |
| `/api/supplier-mappings/:id` | PUT/DELETE | ADMIN | マッピング編集/削除 |
| `/api/optimal-stock/calculate` | POST | AUTH | 適正在庫を計算してDB保存（終売自動判定含む） |
| `/api/optimal-stock/:productId` | GET | AUTH | 商品別の月別適正在庫取得 |
| `/api/optimal-stock/month/:year/:month` | GET | AUTH | 特定月の全商品適正在庫一覧 |
| `/api/health` | GET | - | ヘルスチェック |

## DBスキーマ (主要テーブル)

- **users** — ユーザー (ADMIN / STAFF)
- **categories** — 商品カテゴリ。`department`: FOOD / APPAREL / GOODS。`isFood`: 軽減税率適用フラグ
- **products** — 商品マスタ。`janCode` (JANコード、ユニーク)、`currentStock` (現在庫)、`costPrice` (税込原価)、`sellingPrice` (売価)、`reorderPoint` (発注点)、`optimalStock` (適正在庫)、`optimalStock01`-`optimalStock12` (月別適正在庫、APPAREL用)、`supplyType` (PURCHASED / OEM)、`salesType` (REGULAR / SEASONAL / WEATHER / DISCONTINUED)
- **inventory_transactions** — 在庫変動履歴。type: PURCHASE_CSV / SALE_CSV / ADJUSTMENT / STOCKTAKE / SMAREGI_SYNC
- **csv_imports** — インポート履歴。csvType: PRODUCT_SALES / MONTHLY_SALES / PURCHASE_ETOILE / PURCHASE_COREC / PURCHASE_JANNU。重複チェックに使用
- **sales_records** — 商品別売上記録
- **discount_records** — 値引き・セット売り記録。recordType: DISCOUNT / SET_ITEM / OTHER
- **monthly_sales** — 月次売上サマリー (Smaregi形式の月別売上CSVから)
- **stocktakes** / **inventory_counts** — 棚卸し。status: IN_PROGRESS → COMPLETED
- **supplier_product_mappings** — 仕入先商品名 → 自社商品の紐づけ (supplierName: ETOILE / COREC / JANNU)
- **monthly_optimal_stock** — 月別適正在庫。product_id + year + month でユニーク。avg_daily_sales (過去平均日販)、safety_factor (安全係数)、optimal_stock (= avg_daily_sales × 月日数 × safety_factor)
- **smaregi_configs** — スマレジAPI設定 (contractId, clientId, clientSecret, accessToken)
- **smaregi_sync_logs** — 同期ログ
- **activity_logs** — 操作ログ

## CSVインポート仕様

### 売上CSV (Smaregi形式) — `POST /api/csv`

- csvType: `PRODUCT_SALES` — 商品別売上データ。キー列: `商品コード`, `商品名`, `数量`, `値引き後計`, `部門名`
- 商品コード空欄の行 → `discount_records` に振り分け (値引き: amount < 0 → DISCOUNT、セット売り: amount > 0 → SET_ITEM)
- 合計行 (`商品コード` or `商品名` が "合計") はスキップ
- 未登録JANコードの商品は自動作成。`matchOverrides` で手動マッチング可能
- 在庫減算: `currentStock - quantitySold` (マイナス在庫ガード: `Math.max(0, ...)`)
- `inventory_transactions` に type=SALE_CSV で記録
- csvType: `MONTHLY_SALES` — 月次売上サマリー。キー列: `日付`, `純売上`, `純売上(税抜)`, `消費税`, `総売上`, `値引き`, `販売点数`。`monthly_sales` に upsert

### エトワール海渡 CSV — `POST /api/purchase-import/etoile`

- CSVの `num` × `卸単位` で実数量を計算 (例: num=2, 卸単位=3 → quantity=6)
- `税率` 列 (8 or 10) で原価を税込変換: `unitCost * 1.08` or `unitCost * 1.10`
- JANコードはメーカーJANであり店舗JANと異なるため、`matchProduct` は使わず **SupplierProductMapping のみ** で検索
- 未マッチ商品は新規登録せずスキップ (スマレジに先に登録が必要)
- 重複チェック: 注文番号 (`orderNumber`) で csv_imports を検索
- 確定時にマッピングを upsert 保存 (supplierName: "ETOILE")

### コレック COREC PDF — `POST /api/purchase-import/corec/parse`

- pdf-parse でPDFテキスト抽出 → 品番(6桁)開始パターンで行検出 → JAN正規化
- 全品食品のため原価は **×1.08** (軽減税率) で税込変換
- 3段階のフォールバックパーサー: 正規表現 → トークンベース → 発注書フォーマット
- マッチング: SupplierProductMapping → JANコード → 品番 → 商品名部分一致
- 未マッチ商品は `autoRegister` フラグで自動登録可能 (カテゴリ: 未分類, supplyType: OEM)
- 重複チェック: ファイル名で csv_imports を検索

### ジャヌツー JANNU-2 Excel — `POST /api/purchase-import/jannu/parse`

- xlsx ライブラリで3Dマトリクス Excel をパース: 柄 × カラー × サイズ → SKU 単位に分解
- JANコードなし — `matchProductByNameColorSize` で名前+カラー+サイズの複合検索
- マッチング: SupplierProductMapping → 名前+カラー+サイズの3段階ファジーマッチ
- 未マッチ商品は `autoRegister` フラグで自動登録可能
- 重複チェック: ファイル名で csv_imports を検索

### 共通ルール

- 全仕入先: `csv_imports` テーブルに記録、重複チェックあり (409エラー)
- 全確定処理: `prisma.$transaction` でラップ済み (timeout: 30秒)
- 在庫変動は必ず `inventory_transactions` に記録すること
- マッピング: `supplier_product_mappings` テーブルに保存、次回以降の自動マッチングに使用

## 原価ルール

- **原価 (costPrice) は税込で保存する**
- FOOD (食品): 軽減税率 **8%** → `unitCost * 1.08`
- APPAREL / GOODS: 標準税率 **10%** → `unitCost * 1.10`
- エトワールは CSV の `税率` 列で判定、コレックは全品 8% 固定

## 認証・権限

- express-session ベースのセッション認証 (cookie: `connect.sid`)
- ロール: `ADMIN` (管理者) / `STAFF` (スタッフ)
- 全APIは `requireAuth` ミドルウェアで保護 (`/api/auth` と `/api/health` を除く)
- CSV/仕入インポート、商品編集、スマレジ設定は `requireAdmin` が必要

## スマレジ連携

- 日次自動同期: cron ジョブ (毎日 UTC 06:00 = JST 15:00) で前日の販売データを同期
- 同期処理: スマレジ API からトランザクション明細取得 → JANコードで商品マッチ → currentStock 減算 + inventory_transactions 記録
- 手動同期: `/api/smaregi/sync` で任意の日付を指定可能

## 在庫アラート

- `reorderPoint > 0` かつ `currentStock <= reorderPoint` の商品を抽出
- APPAREL商品は当月の月別適正在庫 (`optimalStock01`-`optimalStock12`) を使用
- severity: `critical` (在庫0 or 発注点の50%以下) / `warning` (発注点以下)

## 開発コマンド

```bash
npm run dev          # フロントエンド (Vite) + バックエンド (tsx) 同時起動
npm run dev:client   # フロントエンドのみ (port 5173)
npm run dev:server   # バックエンドのみ (port 3001)
npm run build        # Vite ビルド
npm run seed         # シードデータ投入
npm run test         # Vitest 実行
npm run test:watch   # Vitest watch モード
```

## よくあるミス・注意点

- **DATABASE_URLを相対パスにしない** — Render の persistent disk は絶対パスでないとアクセスできない
- **buildCommand で DB 操作しない** — ビルド時は persistent disk が未マウント。`prisma db push` と `seed` は必ず startCommand で実行
- **inventory_transactions を作らずに currentStock だけ変更しない** — 在庫変動の監査証跡が失われる。必ず `$transaction` でセットで更新する
- **エトワールの卸単位を無視しない** — `num` だけ見ると実際の入庫数と合わない。`num × 卸単位 = quantity`
- **エトワールのJANコードで matchProduct しない** — メーカーJANと店舗JANが異なるため、SupplierProductMapping のみで検索する
- **コレックの原価に標準税率を使わない** — 全品食品なので軽減税率 8% 固定
- **商品削除は論理削除** — `isActive: false` にする。物理削除すると関連レコードが壊れる
