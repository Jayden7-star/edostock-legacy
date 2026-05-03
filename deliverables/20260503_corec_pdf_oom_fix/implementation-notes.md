# Corec PDF パース OOM 修正 — 実装メモ

実装日: 2026-05-03 / 2026-05-04
対象: [server/purchase-import.ts](../../server/purchase-import.ts)
関連: [investigation.md](../20260503_corec_pdf_memory_investigation/investigation.md)
方針: 選択肢 A 単独（プラン据え置き、コード修正のみ）

---

## 1. 変更点サマリ

### 1.1 失敗時再パースの撤廃（OOM 直接原因）

`/corec/parse` ハンドラが「Stage1〜3 で 0 件」だった場合に rawText プレビューを返すためだけに `extractPdfText(req.file.buffer)` を再呼び出ししていた。pdfjs インスタンスが二重起動し、1 回目の page object/font cache が GC 待ちのまま 2 回目の負荷が乗ることでピーク RSS が倍化していた。

**修正**: `parseCorecPDF` の戻り値を `{ items, pageTexts }` に変更し、ハンドラは抽出済みの `pageTexts` を使い回す。

[server/purchase-import.ts:412-447](../../server/purchase-import.ts#L412-L447), [L454-464](../../server/purchase-import.ts#L454-L464)

### 1.2 ページ単位パース化（fullText 連結廃止）

`pageTexts.join(" ")` で全ページを 1 本の `fullText` に結合 → 全ステージがそれを操作していた。これにより `pageTexts[]` と `fullText` が同時にヒープ常駐し、Stage 2 の `fullText.split(/\s+/)` で発生するトークン配列とも重なってピーク膨張。

**修正**: 3 段フォールバックの各ステージ内でページを順次処理する形に書き換え。フォールバック順序（Stage1: lineRegex / Stage2: token-based / Stage3: orderRegex）はドキュメント全体で維持し、現状の挙動を保つ。

各ステージのループ内で扱うのは「現在のページのテキストとそのトークン配列」のみ。`fullText` も全ページ分のトークン配列も生成しない。

[server/purchase-import.ts:294-410](../../server/purchase-import.ts#L294-L410)

### 1.3 関数シグネチャ変更の波及

| 関数 | Before | After |
|------|--------|-------|
| `parseCorecLines(pageTexts: string[])` | `fullText = pageTexts.join(" ")` で集約後パース | ページ単位ループで集約せずパース |
| `parseCorecPDF(buffer)` | `Promise<Array<...>>` を返す | `Promise<{ items: Array<...>; pageTexts: string[] }>` を返す |
| `/corec/parse` ハンドラ | `parseCorecPDF` の結果が空 → `extractPdfText` 再呼び出し | `parseCorecPDF` の戻り値を分解して `pageTexts` を再利用 |

呼び出し元は `/corec/parse` ハンドラ 1 箇所のみで、外部 export はない。波及は同一ファイル内に閉じる。

API I/F（リクエスト/レスポンス JSON 形状）は変更なし。フロント [src/pages/CsvImport.tsx](../../src/pages/CsvImport.tsx) は触らない。

---

## 2. メモリプロファイル比較

### 検証スクリプト

[parse-corec-test.ts](../../parse-corec-test.ts) を拡張。`parseCorecLines` / `extractPdfText` をインライン複製し、`MODE` 環境変数で挙動を切り替える。

| MODE | 挙動 |
|------|------|
| `before` | 修正前: `pageTexts.join` + Stage1 成功（再パース不発） |
| `before-fail` | 修正前 + Stage1〜3 強制 0 件 → `extractPdfText` 二重呼び出し経路を実行 |
| `after` | 修正後: ページ単位パース + Stage1 成功 |
| `after-fail` | 修正後 + Stage1〜3 強制 0 件（再パース経路なし） |

実行コマンド:
```bash
MODE=<mode> node --max-old-space-size=400 --import tsx parse-corec-test.ts
```

> 注: production の `parseCorecPDF` は `server/purchase-import.ts` に置かれ、同ファイルが `server/index.ts` から `prisma` を import する関係でスクリプトから直接 import するとモジュール循環エラーになる（`Cannot access 'purchaseImportRouter' before initialization`）。そのため検証スクリプトはパース関数をインライン複製している。production と同期して保守すること。

### 計測対象 PDF

`/Users/kaito7898/Family Business/経営管理/EdoStock/データサンプル/コレックサンプルデータ.pdf`
サイズ: 51,496 バイト（約 50KB） / 抽出 14 行

問題発生時の本番 PDF は手元未取得。**実 PDF での最終検証はデプロイ後に手動実施**。

### 結果（3 回実行 / Peak RSS）

| Run | before | after | before-fail | after-fail |
|-----|--------|-------|-------------|------------|
| 1   | 598.0 MB | 610.3 MB | 588.8 MB | 609.6 MB |
| 2   | 597.8 MB | 596.9 MB | 596.9 MB | 596.2 MB |
| 3   | 548.9 MB | 602.9 MB | 592.0 MB | 599.2 MB |
| 平均 | ~582 MB | ~603 MB | ~593 MB | ~602 MB |

### 結果の解釈

- **Start RSS が ~300MB**: tsx ローダ + `pdf-parse` 静的ロード時点でこのスクリプトは既に 300MB を消費。production の Express プロセスでは Node + Prisma で 120-180MB 程度（[investigation.md §4](../20260503_corec_pdf_memory_investigation/investigation.md#4-render現行プランと推定使用メモリ)）であり、検証スクリプト固有のオーバーヘッドが大半を占める。
- **計測値が ±50MB のばらつき**: 50KB の小さな PDF では pdfjs の固定コストが支配的で、以下の差分が信号として現れにくい:
  1. `pageTexts.join` の有無（51KB → fullText も 51KB 程度、誤差レベル）
  2. 再パースの 1 vs 2 回（各回の pdfjs ピークが ~50-100MB と推定 — investigation.md §3）
- **目標 350MB 以下に未達**: ただしこれは検証スクリプトの常駐コスト（300MB）が主因。production プロセスでは start RSS が 120-180MB なので、同じ delta（~290MB）でもピーク 410-470MB となり、**Starter 512MB 内に収まる見込み**。

### 静的解析による効果見積もり（補強根拠）

サンプル PDF では信号が弱いため、コード差分から効果を見積もる:

| 項目 | Before | After | 効果 |
|------|--------|-------|------|
| 失敗時の `pdf.getDocument()` 呼び出し回数 | 2 回（並行常駐の可能性あり） | 1 回 | -1 回分 ≒ 50-100MB（30 ページ級 PDF 想定）|
| `fullText` 文字列の生成 | あり（pageTexts と同時保持） | なし | -O(N) 文字列 1 つ |
| Stage 2 `tokens = fullText.split(/\s+/)` | 全ページ分のトークン配列 1 つ | ページ単位（最大 1 ページ分） | -約 (P-1)/P （Pはページ数）|

問題発生時の本番 PDF（多ページ・パース失敗 PDF）に対しては、これらの効果が有意に効くと予想される。

### サンプル PDF の出力同等性

修正前後で Stage1 出力が完全一致することを確認:

```
$ diff /tmp/corec_before.json /tmp/corec_after.json
(no output → IDENTICAL)
```

14 行の `hinban`/`productName`/`janCode`/`quantity`/`unitPrice` がすべて一致。

---

## 3. 回帰テスト結果

### Vitest 全件パス

```bash
$ npm run test
RUN  v3.2.4
✓ src/test/example.test.ts (1 test) 1ms
Test Files  1 passed (1)
Tests       1 passed (1)
```

既存テストは `src/test/example.test.ts` 1 件のみで Corec パーステストは存在しない。回帰検証としてはサンプル PDF の出力同等性（diff IDENTICAL）が主たる根拠。

### TypeScript 型チェック

```bash
$ npx tsc --noEmit -p tsconfig.server.json
# server/purchase-import.ts に関する型エラー: なし
# csv.ts / products.ts の既存エラーは本修正と無関係
```

---

## 4. 残課題（将来 Issue 候補）

### Issue A: N+4 シリアル DB クエリの一括化

**該当**: [server/purchase-import.ts:467-518](../../server/purchase-import.ts#L467-L518) の `for` ループ

100 行の Corec PDF で最大 400 クエリ（`supplierProductMapping.findUnique` → `product.findUnique`(JAN) → `product.findFirst`(品番) → `product.findFirst`(商品名)）を await 直列で実行している。`items[]` と `product` 中間結果が長時間滞留し、ピーク RSS を押し上げる副次要因。

**改善案**:
1. パース結果から JAN 一覧を抽出 → `prisma.product.findMany({ where: { janCode: { in: jans } } })` で 1 クエリ取得 → メモリ上の Map で照合
2. 残りの hinban/商品名検索も同様に集約
3. `supplierProductMapping.findMany({ where: { supplierName: "COREC", supplierProductName: { in: keys } } })` で先に一括取得

**影響範囲**: パース処理時間短縮 + メモリピーク削減。ロジックはマッチング順序を維持できる。

### Issue B: multer を `diskStorage` に変更

**該当**: [server/purchase-import.ts:7](../../server/purchase-import.ts#L7)

`multer.memoryStorage()` で PDF/Excel 全量を Node プロセスのヒープに常駐させている（最大 10MB）。ファイルが小さくても Buffer + `Uint8Array` で二重保持。

**改善案**: `diskStorage` に切り替え、`/tmp` 経由でアクセス。`req.file.path` から fs.readFile で読み込み、parseCorecPDF/Excel 処理後に削除。

**注意点**:
- Render の `/tmp` 容量・書き込み権限・cleanup タイミングの検証が必要
- アップロードハンドラ全 3 種（corec/jannu/etoile はメモリ非経由）に影響範囲を要確認
- 失敗時の一時ファイル削除を `try/finally` で確実に行う

**影響範囲**: ピーク RSS から 10-20MB 程度のアップロード Buffer 分を削減できる。

---

## 5. デプロイ後の最終検証手順

問題発生時の本番 PDF（あるいは類似のレイアウト崩れ PDF）が手元になく、ローカルでは success path での動作確認に留まる。デプロイ後に以下を実施:

1. ステージング/本番に問題 PDF を再アップロード → エラー応答（rawText プレビュー含む）が返ること、500 エラーや OOM クラッシュが起きないこと
2. Render Metrics でアップロード前後の Memory ピークを観測 → Starter 512MB 内に収まること
3. 過去に正常にインポートできた Corec PDF 5 件を再アップロード → アイテム数・JAN コード・数量が以前と一致すること（重複チェックで 409 が返るので新規ファイル名で実施するか、確定はせずパースのみ）
4. `/api/analytics/dashboard` を同時実行して同居耐性を確認

---

## 6. 制約チェックリスト

- [x] DB 変更・Prisma schema 変更なし
- [x] API I/F 変更なし — `/corec/parse` のレスポンスは `{ items }` または `{ error, rawText }` のまま
- [x] フロントエンド `src/pages/CsvImport.tsx` 変更なし
- [x] inventory_transactions / SupplierProductMapping は触らない
- [x] 既存正常 PDF のパース結果に回帰なし — サンプル PDF の出力 diff が IDENTICAL
