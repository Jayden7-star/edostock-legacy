# EdoStock Legacy — システム仕様書

> 作成日: 2026-03-27
> 対象システム: edostock-legacy
> 対象組織: 江戸一飯田

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術スタック](#2-技術スタック)
3. [アーキテクチャ](#3-アーキテクチャ)
4. [ディレクトリ構成](#4-ディレクトリ構成)
5. [データベース設計](#5-データベース設計)
6. [API仕様](#6-api仕様)
7. [画面仕様](#7-画面仕様)
8. [機能仕様](#8-機能仕様)
9. [認証・認可](#9-認証認可)
10. [外部連携](#10-外部連携)
11. [環境変数・設定](#11-環境変数設定)
12. [デプロイ・インフラ](#12-デプロイインフラ)
13. [開発環境セットアップ](#13-開発環境セットアップ)
14. [既知の制限と課題](#14-既知の制限と課題)

---

## 1. プロジェクト概要

### 1.1 システム概要

**EdoStock** は江戸一飯田（佃煮製造・小売業）向けに開発された、社内用在庫管理 Web アプリケーションである。POS システム（Smaregi）との連携や各仕入先からのデータ取り込みを通じて、リアルタイムな在庫状況把握・発注アラート・需要予測を実現する。

### 1.2 目的・背景

- 現場スタッフが発注タイミングを直感的に把握できる仕組みの構築
- 複数仕入先（Corec / Jannu / エトワール海川）の仕入情報を一元管理
- 過去の売上データをもとにした ABC 分析・季節性分析・需要予測の実施
- 棚卸作業のデジタル化と在庫差異の可視化

### 1.3 利用者

| ロール | 人数目安 | できること |
|---|---|---|
| ADMIN（管理者） | 1〜2名 | 全機能（商品設定・ユーザー管理・データインポート・Smaregi設定を含む） |
| STAFF（スタッフ） | 2〜5名 | ダッシュボード・在庫確認・発注アラート・棚卸・分析の参照 |

---

## 2. 技術スタック

### 2.1 フロントエンド

| 技術 | バージョン | 用途 |
|---|---|---|
| React | 18.3.1 | UIフレームワーク |
| TypeScript | 5.8.3 | 型安全性 |
| Vite + SWC | 5.4.19 / 3.11.0 | ビルドツール・高速HMR |
| React Router DOM | 6.30.1 | ルーティング |
| TanStack Query | 5.83.0 | データフェッチ・キャッシュ |
| React Hook Form + Zod | 7.61.1 / 3.25.76 | フォーム管理・バリデーション |
| Tailwind CSS | 3.4.17 | スタイリング |
| shadcn/ui (Radix UI) | latest | UIコンポーネント群（60+） |
| Recharts | 2.15.4 | グラフ・チャート |
| Framer Motion | 12.34.3 | アニメーション |
| Lucide React | 0.462.0 | アイコン |
| PapaParse | 5.5.3 | クライアント側CSVパース |
| date-fns | 3.6.0 | 日付ユーティリティ |
| Sonner | 1.7.4 | トースト通知 |

### 2.2 バックエンド

| 技術 | バージョン | 用途 |
|---|---|---|
| Node.js | 18+（推奨: 20） | ランタイム |
| Express | 5.2.1 | HTTPサーバー |
| TypeScript + tsx | 5.8.3 / 4.21.0 | 型安全・直接TS実行 |
| Prisma | 6.19.2 | ORM |
| SQLite | — | データベース（ファイルベース） |
| bcryptjs | 3.0.3 | パスワードハッシュ化 |
| express-session | 1.19.0 | セッション管理 |
| Multer | 2.1.0 | ファイルアップロード（メモリストレージ） |
| pdf-parse | 2.4.5 | PDFパース（Corec仕入書） |
| SheetJS（xlsx） | 0.18.5 | Excelパース（Jannu） |
| node-cron | 4.2.1 | 定期実行ジョブ |

### 2.3 開発ツール

| ツール | 用途 |
|---|---|
| Vitest + Testing Library | ユニット・コンポーネントテスト |
| ESLint 9 | コード品質 |
| concurrently | フロント+バック同時起動 |
| lovable-tagger | コンポーネントメタデータ（開発専用） |

---

## 3. アーキテクチャ

```
ブラウザ（React SPA）
    │  HTTP（/api/*）
    ▼
Vite Dev Proxy :8080 ──proxy──► Express :3001
                                    │
                             ┌──────┴──────┐
                             │   Prisma ORM │
                             │   SQLite DB  │
                             └──────┬──────┘
                                    │
                          ┌─────────┴─────────┐
                          │  Smaregi POS API   │
                          │（OAuth2 Client Cred）│
                          └───────────────────┘
```

- **フロントエンド**はシングルページアプリケーション（SPA）。`/api/*` へのリクエストは Vite が Express に転送する。
- **バックエンド**は Express 5 の単一プロセス構成。Prisma 経由で SQLite を操作する。
- **認証**はセッションクッキー方式（express-session / MemoryStore）。
- **定期ジョブ**（毎日 03:00）は node-cron で Express プロセス内に同居する。

---

## 4. ディレクトリ構成

```
edostock-legacy/
├── prisma/
│   ├── schema.prisma          # DBスキーマ定義（14モデル）
│   ├── seed.ts                # 初期データ投入
│   └── dev.db                 # SQLiteファイル（開発用）
│
├── server/
│   ├── index.ts               # Expressサーバー起動・cron・ミドルウェア
│   ├── auth.ts                # 認証・ユーザー管理API
│   ├── products.ts            # 商品CRUD API
│   ├── inventory.ts           # 在庫管理API
│   ├── csv.ts                 # 売上CSVインポートAPI
│   ├── purchase-import.ts     # 仕入データインポートAPI（3仕入先）
│   ├── stocktakes.ts          # 棚卸API
│   ├── analytics.ts           # 分析・予測API
│   └── smaregi.ts             # Smaregi POS連携API
│
├── src/
│   ├── App.tsx                # ルート定義
│   ├── main.tsx               # Reactエントリーポイント
│   ├── pages/                 # ページコンポーネント（14画面）
│   ├── components/
│   │   ├── layout/            # AppLayout・AppHeader・AppSidebar
│   │   ├── dashboard/         # KpiCard・SalesChart・AlertList 等
│   │   └── ui/                # shadcn/ui コンポーネント（60+）
│   ├── hooks/                 # use-toast・use-mobile
│   └── lib/utils.ts           # classname ユーティリティ（cn）
│
├── .env                       # 環境変数
├── vite.config.ts             # Vite設定（proxy・alias）
├── tailwind.config.ts         # カラーテーマ（edo-navy等）
├── prisma.config.ts           # Prisma設定
└── render.yaml                # Render.comデプロイ定義
```

---

## 5. データベース設計

### 5.1 全モデル一覧

```
User                 ユーザー
Category             商品カテゴリ
Product              商品マスタ
InventoryTransaction 在庫移動履歴
Stocktake            棚卸セッション
InventoryCount       棚卸明細
SalesRecord          商品別売上
MonthlySales         月次売上集計
CsvImport            インポート履歴
ActivityLog          操作ログ
SmaregiConfig        Smaregi設定
SmaregiSyncLog       Smaregi同期履歴
```

### 5.2 主要モデル詳細

#### User
| カラム | 型 | 説明 |
|---|---|---|
| id | Int (PK) | |
| email | String (unique) | ログインメール |
| passwordHash | String | bcryptハッシュ |
| role | Enum | `ADMIN` / `STAFF` |
| createdAt / updatedAt | DateTime | |

#### Category
| カラム | 型 | 説明 |
|---|---|---|
| id | Int (PK) | |
| name | String (unique) | システム名 |
| displayName | String | 表示名 |
| isFood | Boolean | 食品フラグ |
| displayOrder | Int | 表示順 |

#### Product
| カラム | 型 | 説明 |
|---|---|---|
| id | Int (PK) | |
| janCode | String? | JANコード |
| name | String | 商品名 |
| color | String? | カラー |
| size | String? | サイズ |
| categoryId | Int (FK) | カテゴリ |
| costPrice | Float? | 原価 |
| sellingPrice | Float? | 販売価格 |
| currentStock | Int | 現在庫数 |
| reorderPoint | Int | 発注点 |
| optimalStock | Int | 適正在庫 |
| supplyType | Enum | `PURCHASED` / `MANUFACTURED` |
| isActive | Boolean | 論理削除フラグ |

#### InventoryTransaction
| カラム | 型 | 説明 |
|---|---|---|
| id | Int (PK) | |
| productId | Int (FK) | |
| type | Enum | `PURCHASE` / `SALE` / `ADJUSTMENT` / `SMAREGI_SYNC` |
| quantity | Int | 変動数量（+/-） |
| stockAfter | Int | 処理後在庫 |
| note | String? | メモ |
| userId | Int? (FK) | 操作ユーザー |
| createdAt | DateTime | |

#### Stocktake / InventoryCount
- **Stocktake**: 棚卸セッション（status: `IN_PROGRESS` / `COMPLETED`）
- **InventoryCount**: 棚卸明細（theoreticalStock・actualStock・discrepancy・reason）

#### SalesRecord / MonthlySales
- **SalesRecord**: 商品×期間の売上（quantitySold・netSales）
- **MonthlySales**: 月次KPI（netSales・taxAmount・grossSales・itemsSold・transactions・customers）

---

## 6. API仕様

### 6.1 共通仕様

- ベースURL（開発）: `http://localhost:3001/api`
- 認証: セッションクッキー必須（`/auth/login` と `/health` を除く）
- Content-Type: `application/json`（ファイルアップロードは `multipart/form-data`）
- ファイルアップロード上限: 10MB

### 6.2 認証 (`/auth`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| POST | `/auth/login` | — | ログイン（email, password） |
| GET | `/auth/session` | 認証済み | セッション確認 |
| POST | `/auth/logout` | 認証済み | ログアウト |
| GET | `/auth/users` | ADMIN | ユーザー一覧 |
| POST | `/auth/users` | ADMIN | ユーザー作成 |
| PUT | `/auth/users/:id` | ADMIN | ユーザー更新 |
| DELETE | `/auth/users/:id` | ADMIN | ユーザー削除 |

### 6.3 商品 (`/products`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/products` | 認証済み | 商品一覧（?search= 対応） |
| POST | `/products` | ADMIN | 商品作成 |
| PUT | `/products/:id` | ADMIN | 商品更新 |
| DELETE | `/products/:id` | ADMIN | 商品論理削除 |
| GET | `/products/categories` | 認証済み | カテゴリ一覧 |

### 6.4 在庫 (`/inventory`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/inventory` | 認証済み | 在庫一覧（?status=ALL/OUT_OF_STOCK/LOW/OK） |
| POST | `/inventory` | 認証済み | 在庫調整・仕入登録（type: PURCHASE / ADJUSTMENT） |
| GET | `/inventory/alerts` | 認証済み | 発注アラート一覧（重篤度ソート済み） |

### 6.5 CSVインポート (`/csv`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| POST | `/csv/` | ADMIN | 売上CSVインポート（csvType: PRODUCT_SALES / MONTHLY_SALES） |
| GET | `/csv/history` | ADMIN | インポート履歴 |

### 6.6 仕入インポート (`/purchase-import`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| POST | `/purchase-import/etoile` | ADMIN | エトワールCSVパース |
| POST | `/purchase-import/etoile/confirm` | ADMIN | エトワールインポート確定 |
| POST | `/purchase-import/corec/parse` | ADMIN | Corec PDFパース |
| POST | `/purchase-import/corec/confirm` | ADMIN | Coreインポート確定 |
| POST | `/purchase-import/jannu/parse` | ADMIN | Jannu Excelパース |
| POST | `/purchase-import/jannu/confirm` | ADMIN | Jannuインポート確定 |

### 6.7 棚卸 (`/stocktakes`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/stocktakes` | 認証済み | 棚卸履歴一覧 |
| POST | `/stocktakes` | 認証済み | 棚卸開始（新規セッション作成） |
| GET | `/stocktakes/:id` | 認証済み | 棚卸詳細 + 明細一覧 |
| PUT | `/stocktakes/:id/counts` | 認証済み | 実棚数・差異理由の更新 |
| POST | `/stocktakes/:id/complete` | 認証済み | 棚卸確定（在庫に反映） |

### 6.8 分析 (`/analytics`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/analytics/dashboard` | 認証済み | ダッシュボードKPI + チャートデータ |
| GET | `/analytics/abc` | 認証済み | ABC分析結果 |
| GET | `/analytics/seasonal` | 認証済み | 季節性分析 |
| GET | `/analytics/forecast` | 認証済み | 需要予測 |
| GET | `/analytics/recommendations` | 認証済み | 商品推奨 |

### 6.9 Smaregi連携 (`/smaregi`)

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/smaregi/config` | ADMIN | 現在の設定取得 |
| POST | `/smaregi/config` | ADMIN | 設定保存・更新 |
| POST | `/smaregi/test` | ADMIN | 接続テスト（トークン取得） |
| POST | `/smaregi/sync` | ADMIN | 手動同期実行 |
| GET | `/smaregi/sync-logs` | ADMIN | 同期履歴（直近30件） |

### 6.10 その他

| メソッド | パス | 権限 | 説明 |
|---|---|---|---|
| GET | `/health` | — | サーバー死活確認 |

---

## 7. 画面仕様

### 7.1 画面一覧

| パス | ページ名 | 権限 | 概要 |
|---|---|---|---|
| `/login` | ログイン | — | メール・パスワード認証 |
| `/` | ダッシュボード | 全員 | KPI・売上チャート・発注アラート・予測 |
| `/inventory` | 在庫管理 | 全員 | 在庫一覧・在庫調整・仕入登録 |
| `/import` | データインポート | ADMIN | 売上CSV・仕入PDF/Excel/CSVの取り込み |
| `/alerts` | 発注アラート | 全員 | 発注点割れ商品の一覧 |
| `/stocktake` | 棚卸 | 全員 | 棚卸の実施・確定・履歴確認 |
| `/analytics/abc` | ABC分析 | 全員 | パレート分析・ABC分類チャート |
| `/analytics/seasonal` | 季節性分析 | 全員 | 月次トレンドチャート・ヒートマップ |
| `/analytics/forecast` | 需要予測 | 全員 | 翌月予測テーブル・予測チャート |
| `/analytics/recommendations` | 推奨 | 全員 | Keep/Review/Replace 商品カード |
| `/settings/products` | 商品設定 | ADMIN | 商品マスタCRUD・一括インポート |
| `/settings/users` | ユーザー設定 | ADMIN | ユーザー管理・ロール設定 |
| `/settings/smaregi` | Smaregi設定 | ADMIN | API設定・同期設定 |
| `*` | 404 | — | ページ未発見 |

### 7.2 共通レイアウト

- **AppLayout**: 認証チェックラッパー（未ログインはログイン画面へリダイレクト）
- **AppHeader**: ヘッダーナビゲーション（ページタイトル・ユーザー情報・ログアウト）
- **AppSidebar**: サイドバーナビゲーション（各ページへのリンク、ロールによる表示制御）

---

## 8. 機能仕様

### 8.1 ダッシュボード

- KPIカード表示: 発注アラート件数・総在庫数・月次売上・粗利率
- 12ヶ月分の売上トレンドチャート（折れ線グラフ）
- 翌月売上予測（季節指数・移動平均）
- 発注アラート上位10件（重篤度順）
- Smaregi同期状況（有効/無効・最終同期日時）
- 季節性メモ（11〜12月の販売強化アラート等）

### 8.2 在庫管理

- 商品一覧: カテゴリ別・ステータス別フィルタリング
- ステータス分類:
  - **在庫切れ**: currentStock = 0
  - **低在庫**: currentStock ≤ reorderPoint
  - **正常**: currentStock > reorderPoint
- 在庫調整ダイアログ: 数量増減・メモ入力
- 仕入登録ダイアログ: 受入数量・メモ入力
- 在庫変動はすべて InventoryTransaction に記録

### 8.3 発注アラート

- 発注点以下の商品を自動抽出
- 重篤度判定:
  - **Critical**: 在庫切れ、または currentStock ≤ reorderPoint × 0.5
  - **Warning**: その他の発注点割れ
- 重篤度・在庫数でソート表示
- 商品詳細（カテゴリ・発注点・適正在庫）を展開表示

### 8.4 データインポート

#### 売上CSV（商品別）
- CSVカラム: 商品名・JANコード・販売数量・純売上
- 新規商品・カテゴリを自動生成
- SalesRecord に蓄積

#### 売上CSV（月次）
- CSVカラム: 年月・純売上・税額・総売上・販売点数・取引数・客数
- MonthlySales に蓄積

#### 仕入PDF（Corec）
- pdf-parse でテキスト抽出
- JANコード・商品名・品番でファジーマッチング
- 未マッチ商品は手動対応UIで紐付け
- カラー・サイズのバリアント対応

#### 仕入Excel（Jannu）
- SheetJS でパース
- Corec と同等のマッチングロジック
- プレビュー確認後にインポート確定

#### 仕入CSV（エトワール海川）
- CSVパース
- 商品マッチングと仕入数量・単価の取り込み

### 8.5 棚卸

1. 棚卸セッション開始 → `IN_PROGRESS` 状態で全商品の InventoryCount を生成
2. スタッフが実棚数を入力（商品ごとに actualStock を更新）
3. 理論在庫との差異（discrepancy）を自動計算
4. 差異理由をプルダウン・自由記述で入力
5. 棚卸確定 → currentStock を actualStock に書き換え、ADJUSTMENT トランザクション生成
6. セッションを `COMPLETED` に移行
7. 棚卸履歴一覧で過去の棚卸参照可能

### 8.6 分析機能

#### ABC分析
- 売上への寄与度で商品をA/B/C分類
  - A: 上位80%の売上を占める商品群
  - B: 次の15%
  - C: 残り5%（死に筋候補）
- パレートチャート表示（棒グラフ + 累積折れ線）

#### 季節性分析
- 月次売上トレンドチャート
- 前年同月比較
- 月×商品カテゴリのヒートマップ

#### 需要予測
- 単純移動平均 + 季節指数による翌月予測
- 11〜12月は季節ブースト係数を適用
- 予測テーブル（商品別・信頼度付き）
- 予測チャート

#### 商品推奨
- 売上パターンから推奨アクションを判定
  - **Keep**: 継続販売推奨
  - **Review**: 見直し検討
  - **Replace**: 入替推奨
- カラーコード付きカードUI
- 季節商品のサジェスト

---

## 9. 認証・認可

### 9.1 認証フロー

```
POST /api/auth/login
  → email・password 検証
  → bcrypt でパスワード照合（saltRounds: 10）
  → セッション生成（userId・role を格納）
  → 200 OK（role を返却）

GET /api/auth/session
  → セッションの userId・role を返却
  → 未認証は 401

POST /api/auth/logout
  → セッション破棄
```

### 9.2 セッション設定

| 項目 | 値 |
|---|---|
| ストレージ | MemoryStore（インメモリ） |
| 有効期限 | 24時間 |
| Cookie名 | `connect.sid`（express-session デフォルト） |
| Secure | 本番環境のみ `true` |
| HttpOnly | `true` |
| SameSite | `Lax` |

### 9.3 権限制御

```typescript
requireAuth   → req.session.userId の存在確認
requireAdmin  → req.session.role === "ADMIN"
```

- ADMIN: 全エンドポイントにアクセス可
- STAFF: 参照系エンドポイントのみアクセス可（インポート・設定変更・ユーザー管理は不可）

### 9.4 開発環境デフォルトアカウント（seed）

| 項目 | 値 |
|---|---|
| メール | `admin@edoichi.com` |
| パスワード | `admin123` |
| ロール | ADMIN |

---

## 10. 外部連携

### 10.1 Smaregi POS 連携

- **認証方式**: OAuth2 Client Credentials フロー
- **取得データ**: 日次トランザクション・商品別売上
- **連携タイミング**:
  - 手動同期（`POST /api/smaregi/sync`）
  - 自動同期（毎日 03:00 / node-cron）
- **設定保存先**: SmaregiConfig テーブル（contractId・clientId・clientSecret・accessToken・tokenExpiry）
- **同期ログ**: SmaregiSyncLog（直近30件を保持）

#### 設定手順
1. Smaregi管理画面でAPIアプリを登録し、Contract ID・Client ID・Client Secret を取得
2. `/settings/smaregi` 画面で入力
3. 「接続テスト」でトークン取得を確認
4. 「自動同期」トグルを ON にして保存

---

## 11. 環境変数・設定

### 11.1 必須環境変数

| 変数名 | 説明 | 例 |
|---|---|---|
| `DATABASE_URL` | Prisma DBパス | `file:./dev.db` |
| `SESSION_SECRET` | セッション暗号化キー | ランダム32文字以上の文字列 |

### 11.2 オプション環境変数

| 変数名 | 説明 |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | Express ポート（デフォルト: 3001） |

### 11.3 Vite プロキシ設定（`vite.config.ts`）

```ts
proxy: {
  "/api": "http://localhost:3001"
}
```

### 11.4 Tailwind カラーテーマ（`tailwind.config.ts`）

| 変数名 | 用途 |
|---|---|
| `edo-navy` | プライマリカラー（紺色） |
| `edo-vermillion` | アクセントカラー（朱色） |
| `edo-gold` | ゴールドアクセント |
| `edo-success` | 正常ステータス |

---

## 12. デプロイ・インフラ

### 12.1 Render.com 構成（`render.yaml`）

| 項目 | 値 |
|---|---|
| サービス種別 | Web Service |
| ランタイム | Node.js 20 |
| リージョン | Singapore |
| プラン | Starter |

#### ビルドコマンド
```bash
npm install && vite build && prisma generate && prisma db push && npx tsx prisma/seed.ts
```

#### 起動コマンド
```bash
NODE_ENV=production npx tsx server/index.ts
```

#### 永続ディスク
- サイズ: 1GB
- マウントパス: `/opt/render/project/src/prisma`
- 用途: SQLiteファイルの永続化

### 12.2 本番環境の注意点

1. **SESSION_SECRET**: Render の自動生成値を使用
2. **DATABASE_URL**: `file:./production.db`（永続ディスク上）
3. **HTTPS**: Render が自動で TLS 終端

---

## 13. 開発環境セットアップ

```bash
# 依存関係インストール
npm install

# DB初期化 + シードデータ投入
npx prisma db push
npx tsx prisma/seed.ts

# 開発サーバー起動（フロント :8080 + バック :3001）
npm run dev
```

### 主要スクリプト

| コマンド | 説明 |
|---|---|
| `npm run dev` | フロント+バック同時起動 |
| `npm run dev:client` | Viteのみ起動 |
| `npm run dev:server` | Expressのみ起動 |
| `npm run build` | 本番ビルド（→ `dist/`） |
| `npm run start` | 本番起動 |
| `npm run seed` | DBシードデータ投入 |
| `npm run test` | テスト実行 |
| `npm run lint` | ESLintチェック |

---

## 14. 既知の制限と課題

| 項目 | 現状 | 推奨対応 |
|---|---|---|
| セッションストレージ | MemoryStore（プロセス再起動で消失） | Redis または DB backed session store |
| データベース | SQLite（単一プロセス制限） | PostgreSQL / MySQL（マルチプロセス対応） |
| ファイルアップロード | メモリストレージのみ | S3 または永続ファイルシステム |
| Cronジョブ | Expressプロセス内に同居 | 独立したスケジューラーサービス |
| APIレートリミット | 未実装 | rate-limiter-flexible 等の導入 |
| エラーハンドリング | 基本的な try-catch | 構造化エラーレスポンス + ロギング基盤 |
| テストカバレッジ | 最小限（example.test.ts のみ） | APIテスト・コンポーネントテストの拡充 |

---

*以上が EdoStock Legacy の全仕様です。*
