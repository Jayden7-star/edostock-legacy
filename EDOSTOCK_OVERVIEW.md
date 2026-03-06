# EdoStock — 在庫管理システム 概要

## プロジェクト概要

**EdoStock** は、老舗佃煮メーカー「江戸一飯田」向けに開発された在庫管理 Web アプリケーションです。  
POS レジ（スマレジ）連携、仕入データインポート、棚卸し、分析・需要予測など、小売+製造業の在庫管理に必要な機能をフルスタックで実装しています。

- **対象ユーザー**: 店舗管理者・スタッフ（2〜5名想定）
- **言語**: 日本語 UI

---

## 技術スタック

### フロントエンド
| 項目 | 技術 |
|---|---|
| フレームワーク | **React 18** + TypeScript |
| ビルドツール | **Vite 5** (SWC plugin) |
| UIライブラリ | **shadcn/ui** (Radix UI ベース) |
| スタイリング | **Tailwind CSS 3** |
| アニメーション | **Framer Motion** |
| チャート | **Recharts** |
| ルーティング | **React Router DOM v6** |
| 状態管理 | React useState / useEffect（軽量） |
| フォーム | React Hook Form + Zod |

### バックエンド
| 項目 | 技術 |
|---|---|
| ランタイム | **Node.js** |
| フレームワーク | **Express 5** |
| 言語 | **TypeScript** (tsx で直接実行) |
| ORM | **Prisma 6** |
| データベース | **SQLite** (ファイルベース) |
| 認証 | **express-session** + **bcryptjs** (セッション認証) |
| ファイルアップロード | **Multer** |
| PDF解析 | **pdf-parse** |
| Excel解析 | **SheetJS (xlsx)** |
| CSV解析 | **PapaParse** (フロントエンド側) |
| スケジューラ | **node-cron** (日次同期用) |

### 開発ツール
| 項目 | 技術 |
|---|---|
| パッケージ管理 | npm |
| TypeScript | 5.8 |
| テスト | Vitest + Testing Library |
| リンター | ESLint 9 |
| 同時起動 | concurrently |

---

## アーキテクチャ

```
┌────────────────────────────────────────────┐
│             ブラウザ (SPA)                   │
│   React + Vite (port 8080)                 │
│   ↕ /api/* → proxy                         │
├────────────────────────────────────────────┤
│         Express API サーバー                │
│         Node.js + tsx (port 3001)           │
│   ↕ Prisma ORM                             │
├────────────────────────────────────────────┤
│          SQLite データベース                 │
│          prisma/dev.db (ファイル)            │
└────────────────────────────────────────────┘
          ↕ 外部API
    スマレジ POS API (OAuth2)
```

### 開発時の起動方法
```bash
npm run dev
# → concurrently で Vite (port 8080) + Express (port 3001) を同時起動
# → Vite が /api/* を Express へプロキシ
```

### 本番ビルド
```bash
npm run build      # → dist/ にフロントエンドの静的ファイルを生成
# バックエンドは npx tsx server/index.ts で起動
# Express が dist/ を静的配信 + API を提供する構成も可能
```

---

## データベース設計 (Prisma + SQLite)

### テーブル一覧（14 モデル）

| モデル | 概要 | 主なフィールド |
|---|---|---|
| **User** | ユーザー管理 | email, passwordHash, role (ADMIN/STAFF) |
| **Category** | 商品カテゴリ | name, displayName, isFood |
| **Product** | 商品マスタ | janCode, name, color, size, costPrice, sellingPrice, currentStock, reorderPoint, supplyType |
| **InventoryTransaction** | 在庫変動履歴 | productId, type (PURCHASE/SALE/ADJUSTMENT/SMAREGI_SYNC等), quantity, stockAfter |
| **CsvImport** | インポート履歴 | filename, csvType, recordCount, status |
| **SalesRecord** | 商品別売上 | productId, quantitySold, netSales, period |
| **MonthlySales** | 月別売上集計 | month, netSales, itemsSold, transactions, customers |
| **Stocktake** | 棚卸し | status (IN_PROGRESS/COMPLETED), discrepancyCount |
| **InventoryCount** | 棚卸し明細 | theoreticalStock, actualStock, discrepancy, reason |
| **ActivityLog** | 操作ログ | action, targetType, description |
| **SmaregiConfig** | スマレジAPI設定 | contractId, clientId, clientSecret, accessToken, syncEnabled |
| **SmaregiSyncLog** | スマレジ同期履歴 | syncDate, recordCount, status, errorMessage |

> **注**: SQLite はファイルベースDB。`prisma/dev.db` が実体。PostgreSQL/MySQL への切替は `schema.prisma` の `provider` 変更 + マイグレーションで対応可能。

---

## APIエンドポイント一覧

### 認証 (`server/auth.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| POST | `/api/auth/login` | ログイン（セッション発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/session` | セッション確認 |

### 商品 (`server/products.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| GET | `/api/products` | 商品一覧 |
| POST | `/api/products` | 商品追加 |
| PUT | `/api/products/:id` | 商品更新 |
| DELETE | `/api/products/:id` | 商品削除（論理削除） |
| GET | `/api/products/categories` | カテゴリ一覧 |

### 在庫 (`server/inventory.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| GET | `/api/inventory` | 在庫一覧（商品+カテゴリ込み） |
| POST | `/api/inventory/receive` | 入庫処理 |
| POST | `/api/inventory/adjust` | 在庫調整 |
| GET | `/api/inventory/alerts` | 発注アラート（reorderPoint以下） |

### CSVインポート (`server/csv.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| POST | `/api/csv/import/product-sales` | 商品別売上CSVインポート |
| POST | `/api/csv/import/monthly-sales` | 月別売上CSVインポート |
| GET | `/api/csv/history` | インポート履歴 |

### 仕入インポート (`server/purchase-import.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| POST | `/api/purchase-import/etoile` | エトワール海渡CSV → マッチングプレビュー |
| POST | `/api/purchase-import/etoile/confirm` | エトワール確定（在庫加算+未登録商品自動登録） |
| POST | `/api/purchase-import/corec/parse` | コレックPDF解析 → マッチングプレビュー |
| POST | `/api/purchase-import/corec/confirm` | コレック確定 |
| POST | `/api/purchase-import/jannu/parse` | ジャヌツーExcel解析 → マッチングプレビュー |
| POST | `/api/purchase-import/jannu/confirm` | ジャヌツー確定 |

### 棚卸し (`server/stocktakes.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| GET | `/api/stocktakes` | 棚卸し履歴 |
| POST | `/api/stocktakes` | 棚卸し開始 |
| GET | `/api/stocktakes/:id` | 棚卸し詳細（明細込み） |
| PUT | `/api/stocktakes/:id/counts` | 実在庫入力 |
| POST | `/api/stocktakes/:id/complete` | 棚卸し確定（在庫反映） |

### 分析 (`server/analytics.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| GET | `/api/analytics/dashboard` | ダッシュボードKPI集計 |
| GET | `/api/analytics/abc` | ABC分析（パレート） |
| GET | `/api/analytics/seasonal` | 季節性分析 |
| GET | `/api/analytics/forecast` | 需要予測 |
| GET | `/api/analytics/recommendations` | 商品切替提案 |

### スマレジ連携 (`server/smaregi.ts`)
| メソッド | パス | 機能 |
|---|---|---|
| GET | `/api/smaregi/config` | スマレジ設定取得 |
| POST | `/api/smaregi/config` | スマレジ設定保存 |
| POST | `/api/smaregi/test` | 接続テスト |
| POST | `/api/smaregi/sync` | 手動同期実行 |
| GET | `/api/smaregi/sync-logs` | 同期履歴（直近30件） |

---

## 画面一覧（14ページ）

| パス | ファイル | 機能 |
|---|---|---|
| `/login` | Login.tsx | ログイン画面 |
| `/` | Index.tsx | ダッシュボード（KPI, 売上チャート, アラート, 予測バナー, スマレジ同期ステータス） |
| `/inventory` | Inventory.tsx | 在庫一覧 + 入庫/調整モーダル |
| `/import` | CsvImport.tsx | CSV/PDF/Excelインポート（売上タブ + 仕入タブ: 3社対応） |
| `/alerts` | Alerts.tsx | 発注アラート一覧 |
| `/stocktake` | Stocktake.tsx | 棚卸し（開始→入力→確定フロー + 履歴） |
| `/analytics/abc` | AbcAnalysis.tsx | ABC分析（パレート図） |
| `/analytics/seasonal` | SeasonalAnalysis.tsx | 季節性分析（月別トレンド + ヒートマップ） |
| `/analytics/forecast` | Forecast.tsx | 需要予測（テーブル + グラフ） |
| `/analytics/recommendations` | Recommendations.tsx | 商品切替提案（色分けカード） |
| `/settings/products` | ProductSettings.tsx | 商品マスタCRUD |
| `/settings/users` | UserSettings.tsx | ユーザー管理 |
| `/settings/smaregi` | SmaregiSettings.tsx | スマレジ連携設定（API設定, 同期ON/OFF, 履歴） |

---

## 外部サービス連携

### スマレジ POS API
- **OAuth2 Client Credentials Flow** でトークン取得
- 販売データ（transaction details）を日次で自動取得（cron: 毎日3:00 AM）
- 商品コード別に販売数を集計 → 在庫を自動減算
- 手動同期も可能

---

## デプロイに関する重要ポイント

### 現在の構成
- **フロントエンド**: Vite で静的ビルド → `dist/` に出力（約1MB）
- **バックエンド**: Express サーバー（tsx で TypeScript を直接実行）
- **データベース**: SQLite ファイル（サーバーのローカルファイルシステム）
- **セッション**: express-session（メモリストア — 本番では永続ストアに要変更）
- **ファイルアップロード**: メモリストレージ（最大10MB）
- **定期実行**: node-cron（サーバープロセス内で動作）

### デプロイ時の考慮事項

1. **データベース**:
   - 現在 SQLite（ファイルベース） → サーバーレス環境では永続化に注意
   - PostgreSQL/MySQL に移行する場合は `schema.prisma` の `provider` を変更して `npx prisma migrate` を実行
   - SQLite のままデプロイするなら、永続ディスクが必要

2. **環境変数**:
   - `DATABASE_URL`: Prisma接続先（現在: `file:./dev.db`）
   - `SESSION_SECRET`: セッション暗号化キー（本番用に設定が必要）

3. **Node.jsバージョン**: 18以上推奨

4. **セッションストア**: 本番では Redis や DB ベースのセッションストアに変更が推奨

5. **cronジョブ**: サーバープロセス内で `node-cron` が動作。サーバーが停止するとcronも停止

6. **ポート**:
   - 開発時: Vite = 8080, Express = 3001
   - 本番: Express が `dist/` を静的配信 + API を同一ポートで提供する想定

7. **ビルドサイズ**:
   - フロントエンド: JS 約1MB (gzip 305KB), CSS 67KB (gzip 12KB)
   - バックエンド: TypeScript ソース（ビルド不要、tsx で直接実行）

---

## ディレクトリ構成

```
edostock-legacy/
├── prisma/
│   ├── schema.prisma        # DBスキーマ定義（14モデル）
│   ├── seed.ts              # 初期データ投入スクリプト
│   └── dev.db               # SQLite データベースファイル
├── server/                  # バックエンド（Express + Prisma）
│   ├── index.ts             # サーバーエントリーポイント + cron
│   ├── auth.ts              # 認証API
│   ├── products.ts          # 商品CRUD
│   ├── inventory.ts         # 在庫管理API
│   ├── csv.ts               # 売上CSVインポート
│   ├── purchase-import.ts   # 仕入インポート（3社対応）
│   ├── stocktakes.ts        # 棚卸しAPI
│   ├── analytics.ts         # 分析・予測API
│   └── smaregi.ts           # スマレジ連携API
├── src/                     # フロントエンド（React SPA）
│   ├── pages/               # 14ページコンポーネント
│   ├── components/          # 共通UIコンポーネント（shadcn/ui）
│   ├── hooks/               # React Hooks
│   ├── lib/                 # ユーティリティ
│   ├── App.tsx              # ルーティング定義
│   └── index.css            # Tailwind + カスタムテーマ
├── package.json
├── vite.config.ts           # Vite設定（proxy含む）
├── tailwind.config.ts
└── tsconfig.*.json          # TypeScript設定
```

---

## 初期セットアップ手順

```bash
# 依存関係インストール
npm install

# データベース初期化
npx prisma db push
npx tsx prisma/seed.ts

# 開発サーバー起動
npm run dev

# アクセス: http://localhost:8080
# ログイン: admin@edoichi.com / admin123
```
