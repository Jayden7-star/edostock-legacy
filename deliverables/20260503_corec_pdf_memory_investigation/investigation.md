# Corec PDF アップロードエラー / Render OOM 調査レポート

調査日: 2026-05-03
対象: edostock-legacy `POST /api/purchase-import/corec/parse`
スコープ: 原因特定・方針提示のみ（修正コード・DB 変更なし）

---

## Context

- 江戸一飯田の Corec 仕入先 PDF をアップロードしたところ「読み込みエラー」で失敗
- 同時刻に Render から `Web Service edostock exceeded its memory limit` 通知 → インスタンス自動再起動
- メモリ超過と PDF パース処理の関連を疑っている
- 推測ではなくコードと設定ファイルの根拠から原因候補を特定する

---

## 1. 該当ファイル一覧（行番号付き）

| 役割 | パス | 行 |
|------|------|----|
| ルーター登録（`requireAdmin`） | [server/index.ts](../../server/index.ts) | router mount |
| multer 定義（memoryStorage / 10MB） | [server/purchase-import.ts:7](../../server/purchase-import.ts#L7) | 7 |
| `pdf-parse` import | [server/purchase-import.ts:4](../../server/purchase-import.ts#L4) | 4 |
| `extractPdfText`（pdfjs ラッパー） | [server/purchase-import.ts:273-292](../../server/purchase-import.ts#L273-L292) | 273–292 |
| `parseCorecLines`（3 段フォールバック） | [server/purchase-import.ts:294-399](../../server/purchase-import.ts#L294-L399) | 294–399 |
| `parseCorecPDF`（エントリ） | [server/purchase-import.ts:405-428](../../server/purchase-import.ts#L405-L428) | 405–428 |
| `/corec/parse` ハンドラ | [server/purchase-import.ts:430-529](../../server/purchase-import.ts#L430-L529) | 430–529 |
| `/corec/confirm` ハンドラ | [server/purchase-import.ts:531-670](../../server/purchase-import.ts#L531-L670) | 531–670 |
| フロント送信（FormData） | [src/pages/CsvImport.tsx:1002-1012](../../src/pages/CsvImport.tsx#L1002-L1012) | 1002–1012 |
| 検証用スクリプト（pdfjs-dist 直接） | [parse-corec-test.ts](../../parse-corec-test.ts) | — |
| Render 設定 | [render.yaml](../../render.yaml) | 1–22 |

---

## 2. 使用ライブラリと処理方式

- **PDF ライブラリ**: `pdf-parse@^2.4.5`（[package.json](../../package.json)）。内部で `pdfjs-dist@^4.0.379` を使用
- **アップロード**: `multer.memoryStorage()`、`fileSize: 10 MB`（[server/purchase-import.ts:7](../../server/purchase-import.ts#L7)）
- **処理方式**: ストリーミング不使用。**全量バッファ → 全ページテキスト連結 → 大域正規表現** のバッチ処理
- **データフロー**（`/corec/parse`）:
  1. `req.file.buffer`（Buffer, 最大 10MB）が multer から渡される
  2. `new PDFParse({ data: new Uint8Array(buffer) })`（[L274](../../server/purchase-import.ts#L274)）— バッファを **もう一度コピー**
  3. `parser.getText()` が全ページの text を返す → `pageTexts: string[]`（[L279](../../server/purchase-import.ts#L279)）
  4. `pageTexts.join(" ")` で **全ページを 1 本の巨大文字列に連結**（[L300](../../server/purchase-import.ts#L300)）
  5. グローバル正規表現で行抽出（[L305](../../server/purchase-import.ts#L305)）→ 失敗時はトークン分割パース → さらに失敗時は別正規表現
  6. `parsed[]` を 1 件ずつループしながら **最大 4 種類の Prisma クエリを直列実行**（[L454-518](../../server/purchase-import.ts#L454-L518)）

---

## 3. メモリ消費が疑われる箇所トップ 3

### 🔴 #1 失敗時に PDF を再パース（同じバッファを 2 回 pdf-parse）

**[server/purchase-import.ts:436 → 440](../../server/purchase-import.ts#L436-L450)**

```ts
const parsed = await parseCorecPDF(req.file.buffer);   // 1 回目
if (parsed.length === 0) {
    try {
        const pageTexts = await extractPdfText(req.file.buffer);  // 2 回目!
```

- パースに失敗した（=正規表現が 1 つもヒットしなかった）PDF は、メモリ的にも厳しいタイプ（大きい/レイアウト崩れ/画像多め）の可能性が高い
- **同じ buffer に対して `new Uint8Array(buffer)` を作り直し、PDFParse インスタンスを新規生成**して `getText()` を再実行している
- 1 回目側の `parser.destroy()`（[L290](../../server/purchase-import.ts#L290)）が走っても、pdfjs の page object / font cache は GC 待ち。2 回目の負荷が同時に乗ることでピーク RSS が倍化しやすい
- ユーザーには「読み込みエラー」と見えるが、内部ではこの **失敗→再パース** で OOM に至っている可能性が最も高い

### 🟠 #2 全ページテキスト連結 + 巨大文字列に対する複雑正規表現

**[server/purchase-import.ts:300, 305, 323](../../server/purchase-import.ts#L300-L323)**

```ts
const fullText = pageTexts.join(" ");                                  // L300
const lineRegex = /(\d{6})\s+([\u3000-\u9FFF\uF900-\uFAFF\w（）\s]+?)
                  \s+(4970974[\s\-…]*\d+(?:\n\d+)?)
                  \s+(.+?)\s+(\d+)\s+[¥￥]([\d,]+)
                  \s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;                  // L305
…
const tokens = fullText.split(/\s+/);                                  // L323（fallback）
```

- **連結戦略**: ページ単位で処理せず全ページを 1 本に結合 → ピーク時に `pageTexts[]` と `fullText` の両方が同時にヒープ常駐
- **正規表現**: `.+?` の lazy 量化子 + ユニコードクラス + 改行跨ぎグループ。**マッチしないテキスト**ほど V8 は backtracking で時間と一時メモリを消費
- **fallback 1** が走ると `fullText.split(/\s+/)` で **トークン配列**を生成（数千〜数万要素）。続く for ループ内で `nameTokens[]` / `janTokens[]` / `cleaned` 文字列を毎反復生成 → 短命オブジェクト多発
- 30 ページ級の Corec 月次発注書を想定すると、`fullText` だけで数 MB、トークン配列とその要素で **同一データを 2〜3 倍に膨らませて保持**

### 🟡 #3 multer memoryStorage + Uint8Array 二重保持 + N+4 シリアル DB クエリ

**[server/purchase-import.ts:7, 274, 454-518](../../server/purchase-import.ts#L7)**

- [L7](../../server/purchase-import.ts#L7): `memoryStorage()` で **PDF 全量を Buffer として常駐**（最大 10MB）。`diskStorage()` なら一時ファイル経由で済む
- [L274](../../server/purchase-import.ts#L274): `new Uint8Array(buffer)` で **同じバイト列を 2 つ持つ**。pdfjs-dist は内部でさらにページ object / font cache を確保
- [L454-518](../../server/purchase-import.ts#L454-L518): パース結果 `parsed[]` を 1 件ずつ `for` ループし、`supplierProductMapping.findUnique` → `product.findUnique`(JAN) → `product.findFirst`(品番) → `product.findFirst`(商品名 AND 配列) と **直列で最大 4 クエリ**
  - 100 行 PDF で 400 クエリ、await の累積で `items[]` と `product` 中間結果が長時間滞留
  - これ単体で OOM 直行とは言いづらいが、#1/#2 と同居するとピークを押し上げる

#### 補足: 解放フックは入っているがピーク削減ではない
- [L290](../../server/purchase-import.ts#L290) `await parser.destroy()` は finally 句にあり、リーク自体は避けている（コミット 71def60 で追加された経緯）
- しかし「ピーク時の同時保持量」は減らせていない。OOM はリークではなく **単発ピーク超過** が主因と推定

---

## 4. Render 現行プランと推定使用メモリ

| 項目 | 値 | 出典 |
|------|----|------|
| プラン | **Starter** | [render.yaml:6](../../render.yaml#L6) |
| メモリ上限 | **512 MB RAM**（Render Starter 公式値） | Render docs |
| CPU | 0.5 CPU | Render docs |
| リージョン | Singapore | [render.yaml:5](../../render.yaml#L5) |
| Persistent Disk | 1 GB（DB 用、メモリ補助には不可） | [render.yaml:9-12](../../render.yaml#L9-L12) |
| `--max-old-space-size` | 未指定 | [render.yaml:8](../../render.yaml#L8) |

### 推定 RSS の内訳（Corec PDF パース失敗時の最悪ケース）

| コンポーネント | 推定 |
|--------|------|
| Node + Express + Prisma 常駐 | 120–180 MB |
| pdfjs-dist のロード（fonts/cmaps） | 40–80 MB |
| `req.file.buffer` (10MB) + `Uint8Array` コピー | 20 MB |
| `pageTexts[]` + `fullText` | 5–20 MB |
| **失敗時の再パース（#1）でもう 1 セット** | **+50–100 MB** |
| トークン配列 + 中間文字列 | 10–30 MB |
| Prisma クエリ中の object graph | 10–30 MB |
| **合計ピーク（推定）** | **約 280–450 MB（成功時）／380–600 MB（失敗→再パース時）** |

**結論**: Starter 512MB は通常時は収まるが、**失敗→再パース経路に入ると上限超過する可能性が高い**。OOM 通知が出たことと整合する。

---

## 5. 修正方針（A / B / C）と推奨案

### 選択肢 A: コード最適化（プラン据え置き）

1. **失敗時の再パースを撤廃**（[L440](../../server/purchase-import.ts#L440)） — 1 回目の `extractPdfText` 結果を変数で保持して再利用
2. **ページ単位パース** — `parseCorecLines` を `pageTexts.forEach((text) => ...)` に書き換え、`fullText` の連結を廃止。ページ毎にマッチ → 結果 merge
3. **正規表現の前処理** — 行候補（`/^\d{6}\s/m`）でフィルタしてから精密正規表現を当てる二段構え。fallback の `split(/\s+/)` も行ベースに
4. **N+4 を JAN 一括取得に変更** — `prisma.product.findMany({ where: { janCode: { in: jans } } })` 1 クエリ + メモリでマッチ
5. **multer を `diskStorage` に変更** — `/tmp` 経由で常駐 Buffer を逃がす（Render の `/tmp` 容量と書き込み権限は要検証）

リスク: 機能変更なし、テスト容易。`parse-corec-test.ts` を流用して回帰確認可能。

### 選択肢 B: Render プラン引き上げ

- Starter (512MB) → **Standard (2GB) もしくは Pro (4GB)**
- 月額が増える（Standard は概ね $25/mo）が、**即効性最大** で確実に解消
- DB は同じ persistent disk のまま使える

### ✅ 選択肢 C: 両方（推奨）

1. **短期**: 一時的に Standard へ昇格して業務復旧（同日中）
2. **中期**: A の #1（失敗時再パース撤廃）と #2（ページ単位パース）を実装してから、再度 Starter に戻すかを判断
3. **長期**: N+4 を `findMany({ in: })` に最適化、CSV/Jannu と共通の matcher に集約

> Starter 据え置きで A だけで十分かはサンプル PDF 次第で読み切れず、業務影響を最小化するため **一旦 B で復旧 → 落ち着いて A を入れて評価**、が最も安全。

---

## 6. 次のステップで Render ログから確認すべき情報

1. **OOM 直前のリクエスト** — Logs で `POST /api/purchase-import/corec/parse` の直後に `Out of memory` または `process exited` があるか
2. **PDF サイズと処理時間** — 該当リクエストの `Content-Length`、レスポンス到達前に kill されたか
3. **同時実行リクエスト** — OOM 直前に `/api/analytics/dashboard`（[server/analytics.ts:11](../../server/analytics.ts#L11) の無制限 `findMany`）など重い API が並走していないか
4. **発生頻度** — 同じ Corec PDF を 2 回目に投げると再現するか（idempotency 確認）
5. **メモリ推移** — Render Metrics（Memory）で前日対比、Crash 数分前にメモリが直線的に上がったか / スパイク 1 発か（リーク vs 単発ピーク判別）
6. **Node 起動オプション** — `--max-old-space-size` 指定なし。`NODE_OPTIONS=--max-old-space-size=400` などで早期 GC を促せるか検討
7. **問題 PDF の取得** — ユーザーから当該 PDF を入手し、ローカルで `parse-corec-test.ts` 経由でメモリプロファイル（`node --inspect` + Chrome DevTools）

---

## 7. 既知の関連事実（Git 履歴より）

- **2026-04-11 71def60** `fix: コレックPDF解析エラーを修正 - エラーハンドリング強化` — `parser.destroy()` を finally に追加、buffer 検証強化。**過去にも解析時のリソース問題は意識されていた**
- 2026-04-11 623727d — confirm 系を `prisma.$transaction({timeout: 30000})` でラップ
- 2026-04-05 b16e74e — JAN なし発注書フォーマット（Fallback 2）を追加。fallback 経路が増えたぶん、`fullText` 上の正規表現リトライ機会も増加
- メモリ・OOM・crash を主題にしたコミットは **未記録**（今回が初の正式インシデント記録）

---

## 8. 検証方法（修正実装フェーズ用・参考）

修正コードは今回スコープ外だが、A/C 実装後の確認手順を記しておく。

1. ローカルで `parse-corec-test.ts` を改造し、ユーザー提供の問題 PDF を入力
2. `node --max-old-space-size=400 -r tsx/cjs parse-corec-test.ts` で **Render 同等メモリ制約下** にて完走するか
3. `process.memoryUsage().rss` を要所でログし、ピークが 350MB を超えないことを確認
4. `npm run test`（vitest）で既存パーステスト通過
5. ステージングへ deploy → 過去の正常 PDF 5 件 + 問題 PDF 1 件を順次アップロード、Render Metrics でピーク確認
6. プラン据え置きで運用するなら、`/api/analytics/dashboard` を同時実行して同居耐性を確認

---

## 注意点 / 未確定事項

- Render Starter のメモリ上限は **公式値 512MB を前提**。最新のプラン体系で値が変わっていないかは Render dashboard で再確認推奨
- pdf-parse v2 系は v1 系から API が変わっており、メモリ特性も別物。`getText()` のページ単位 API があれば streaming 化の余地あり（要 docs 確認）
- Corec PDF の実サンプルは未取得。ページ数・サイズは推定値。実 PDF 入手後にピーク試算の精度を上げる

---

## 追記 (2026-05-04): 修正実施と将来 Issue

選択肢 A の必須 2 項目（#1 失敗時再パース撤廃 / #2 ページ単位パース化）を実装。詳細は [../20260503_corec_pdf_oom_fix/implementation-notes.md](../20260503_corec_pdf_oom_fix/implementation-notes.md)。

### 今回スコープ外 → 別 Issue で対応

選択肢 A の残項目 #4 と #5 は今回の修正に含めず、後続 Issue で対応する:

- **Issue A: N+4 シリアル DB クエリの一括化** — `prisma.product.findMany({ where: { janCode: { in: jans } } })` 等への集約。パース処理時間短縮 + ピーク RSS 削減の副次効果。
- **Issue B: multer を `diskStorage` に変更** — `/tmp` 経由で常駐 Buffer を逃がす。Render の `/tmp` 容量・書き込み権限の事前検証が必要。

これらは今回の OOM の主因（#1, #2）が解消した後に効果検証して着手する方が、A/B テストとして影響を切り分けやすい。
