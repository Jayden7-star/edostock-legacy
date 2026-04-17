# 無効商品の表示・有効化 バックエンドAPI実装レポート

**実施日**: 2026-04-17
**対象ファイル**: `edostock-legacy/server/products.ts`

## 実装内容

### 1. GET /api/products の拡張

`isActive` クエリパラメータを追加し、無効商品の取得を可能にした。

| パラメータ値 | 動作 |
|-------------|------|
| 未指定 / `true` | 有効商品のみ返却（後方互換性維持） |
| `false` | 無効商品のみ返却 |
| `all` | 全商品を返却 |

既存の `search`, `department` フィルタと併用可能。

### 2. PATCH /api/products/:id/activate（新規）

指定IDの商品を有効化（`isActive: true`）する。

- **権限**: ADMIN
- **レスポンス**: 更新後の商品オブジェクト（category含む）
- **エラー**: 404（存在しないID）

### 3. PATCH /api/products/bulk-activate（新規）

複数商品を一括有効化する。

- **権限**: ADMIN
- **リクエスト**: `{ ids: number[] }`
- **レスポンス**: `{ success: true, updatedCount: number, updatedIds: number[] }`
- **トランザクション**: `prisma.$transaction` で実装
- **エラー**: 400（空配列）

### 4. PATCH /api/products/bulk-deactivate（新規）

複数商品を一括無効化する。bulk-activate と対称的な設計。

- **権限**: ADMIN
- **リクエスト**: `{ ids: number[] }`
- **レスポンス**: `{ success: true, updatedCount: number, updatedIds: number[] }`
- **トランザクション**: `prisma.$transaction` で実装
- **エラー**: 400（空配列）

## エンドポイント一覧

| パス | メソッド | 権限 | 概要 | 状態 |
|------|----------|------|------|------|
| `/api/products?isActive=` | GET | AUTH | 商品一覧（isActiveフィルタ追加） | 拡張 |
| `/api/products/:id/activate` | PATCH | ADMIN | 単体有効化 | 新規 |
| `/api/products/bulk-activate` | PATCH | ADMIN | 一括有効化 | 新規 |
| `/api/products/bulk-deactivate` | PATCH | ADMIN | 一括無効化 | 新規 |

## 既存「非表示」との対称性

| 操作 | 個別 | 一括 |
|------|------|------|
| 無効化 | `DELETE /api/products/:id` (既存) | `PATCH /api/products/bulk-deactivate` (新規) |
| 有効化 | `PATCH /api/products/:id/activate` (新規) | `PATCH /api/products/bulk-activate` (新規) |

## 動作確認結果

### テスト環境
- ローカル開発サーバー（localhost:3001）
- 管理者アカウントでログイン

### テスト結果

| # | テスト内容 | 結果 |
|---|-----------|------|
| 1 | `GET /api/products`（デフォルト）で有効商品のみ返却 | OK |
| 2 | `GET /api/products?isActive=all` で全件返却 | OK |
| 3 | `GET /api/products?isActive=false` で無効商品のみ返却 | OK |
| 4 | `PATCH /api/products/1/activate` で単体有効化 | OK |
| 5 | `PATCH /api/products/bulk-deactivate` で複数無効化 | OK |
| 6 | `PATCH /api/products/bulk-activate` で複数有効化 | OK |
| 7 | 存在しないIDで activate → 404エラー | OK |
| 8 | 空配列で bulk-activate → 400エラー | OK |
| 9 | 存在しないIDのみで bulk-activate → updatedCount: 0 | OK |
| 10 | `isActive` + `search` パラメータ併用 | OK |
| 11 | TypeScript型チェック (`tsc --noEmit`) | OK |
| 12 | 既存テスト (`vitest run`) | OK (1/1 passed) |
