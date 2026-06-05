// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeJan, isAmountConsistent, parseCorecLines, getAmountInvalidItems } from "../../server/corec-parser";

// ---------------------------------------------------------------------------
// Fixtures: pdf-parse(getText) 相当の抽出テキストを文字列で再現する。
// PDFバイナリはテストに含めない（純粋関数 parseCorecLines のテストに集中する）。
// ---------------------------------------------------------------------------

// 藤一 → 江戸一飯田 の発注書（注文番号 102712-A0005947）。
// 特徴: 品番列が空 / JAN先頭が 4589950（4970974 ではない）/ JANがハイフン+改行で 7桁-6桁に分割 /
//       「対象」が "対\n象" に分割される。
const FUJIICHI_PAGE = `株式会社　藤一
濱田　様
FAX：046-263-6286
発注書
注文日時：2026/5/25 14:18　注文番号：102712-A0005947
発注者
お届け先
希望納品日時
メッセージ
株式会社　江戸一飯田
築地本店
森田 智子
TEL：03−3543−5225  FAX：03−3549−2011
株式会社江戸一飯田　築地本店
〒104−0045 東京都 中央区 築地4−13−4
TEL：03−3543−5225
2026/06/05 時間指定なし
お世話になっております。
よろしくお願いいたします。
品番 商品名 ＪＡＮコード 規格 入数 発注単価 数量 軽減税
率 発注金額 備考
あおさせんべい　国産のり 4589950-
119742
52g 12 ¥278 24 対
象
¥6,672
ぬれぼし煎 4589950-
111517
100g 12 ¥293 24 対
象
¥7,032
ひとくちミニ揚げ煎　はちみつ 4589950-
119728
70g 15 ¥292 30 対
象
¥8,760
1 / 1ページ
小計（税抜） ¥22,464
消費税 ¥1,797
合計 ¥24,261
8% 対象 ¥22,464
消費税 ¥1,797
　計　 ¥24,261
10% 対象 ¥0
消費税 ¥0
　計　 ¥0`;

// 旧フォーマット（COREC・別仕入先）。品番6桁あり / JAN先頭 4970974。後方互換の確認用。
const LEGACY_4970974_PAGE = `品番 商品名 ＪＡＮコード 規格 入数 発注単価 数量 軽減税率 発注金額 備考
233563 たらこ 4970974- 101026 70g 築地 10 ¥232 20 対 象 ¥4,640
233564 すじこ 4970974- 101033 90g 築地 8 ¥350 12 対 象 ¥4,200`;

// 検算が合わない行（発注単価×数量 ≠ 発注金額）。amountValid=false を確認する用。
const AMOUNT_MISMATCH_PAGE = `品番 商品名 ＪＡＮコード 規格 入数 発注単価 数量 軽減税率 発注金額 備考
テスト商品 4589950-
100008
10g 5 ¥100 3 対
象
¥999`;

describe("normalizeJan", () => {
    it("ハイフン+改行で分割されたJANを13桁に正規化する", () => {
        expect(normalizeJan("4589950-\n119742")).toBe("4589950119742");
        expect(normalizeJan("4589950- 119742")).toBe("4589950119742");
        expect(normalizeJan("4589950119742")).toBe("4589950119742");
    });

    it("全角ハイフン/全角空白/各種ダッシュを除去する", () => {
        expect(normalizeJan("4589950－119742")).toBe("4589950119742"); // 全角ハイフン
        expect(normalizeJan("4589950‐119742")).toBe("4589950119742"); // U+2010
        expect(normalizeJan("4589950　119742")).toBe("4589950119742"); // 全角空白
        expect(normalizeJan("4970974- 101026")).toBe("4970974101026");
    });
});

describe("isAmountConsistent (発注単価×数量=発注金額の検算)", () => {
    it("一致すれば true", () => {
        expect(isAmountConsistent(278, 24, 6672)).toBe(true);
        expect(isAmountConsistent(292, 30, 8760)).toBe(true);
    });
    it("不一致なら false", () => {
        expect(isAmountConsistent(100, 3, 999)).toBe(false);
    });
    it("いずれかが0（検算不能）なら true（行を落とさない）", () => {
        expect(isAmountConsistent(0, 24, 6672)).toBe(true);
        expect(isAmountConsistent(278, 24, 0)).toBe(true);
    });
});

describe("parseCorecLines — 藤一フォーマット（品番空欄・JAN先頭4589950）", () => {
    const lines = parseCorecLines([FUJIICHI_PAGE]);

    it("3行を抽出する", () => {
        expect(lines).toHaveLength(3);
    });

    it("JANをハイフン+改行込みで13桁に正規化して抽出する", () => {
        expect(lines.map((l) => l.janCode)).toEqual([
            "4589950119742",
            "4589950111517",
            "4589950119728",
        ]);
    });

    it("数量は『数量』列の値（24 / 24 / 30）で、入数×数量にはならない", () => {
        expect(lines.map((l) => l.quantity)).toEqual([24, 24, 30]);
        // 入数(12/12/15)×数量(24/24/30) にならないこと
        expect(lines[0].quantity).not.toBe(12 * 24); // 288 ではない
        expect(lines[1].quantity).not.toBe(12 * 24);
        expect(lines[2].quantity).not.toBe(15 * 30); // 450 ではない
    });

    it("発注単価を正しく抽出する", () => {
        expect(lines.map((l) => l.unitPrice)).toEqual([278, 293, 292]);
    });

    it("発注金額（subtotal）を抽出し、発注単価×数量=発注金額の検算が通る", () => {
        expect(lines.map((l) => l.subtotal)).toEqual([6672, 7032, 8760]);
        expect(lines.every((l) => l.amountValid)).toBe(true);
    });

    it("商品名をJANの直前まで（規格・入数を含めず）で抽出する", () => {
        expect(lines[0].productName).toBe("あおさせんべい 国産のり");
        expect(lines[1].productName).toBe("ぬれぼし煎");
        expect(lines[2].productName).toBe("ひとくちミニ揚げ煎 はちみつ");
        // 規格/入数が商品名に混入していないこと
        for (const l of lines) {
            expect(l.productName).not.toMatch(/¥|対象|\d+g\b/);
        }
    });

    it("在庫加算に使う数量が +24 / +24 / +30 に一致する", () => {
        expect(lines.reduce((s, l) => s + l.quantity, 0)).toBe(78); // 24+24+30
    });
});

describe("parseCorecLines — 検算ガード", () => {
    it("発注単価×数量≠発注金額の行は amountValid=false になる", () => {
        const lines = parseCorecLines([AMOUNT_MISMATCH_PAGE]);
        expect(lines).toHaveLength(1);
        expect(lines[0].quantity).toBe(3);
        expect(lines[0].unitPrice).toBe(100);
        expect(lines[0].subtotal).toBe(999);
        expect(lines[0].amountValid).toBe(false);
    });
});

describe("getAmountInvalidItems (confirm安全弁)", () => {
    it("amountValid===false の item だけを抽出する", () => {
        const items = [
            { productName: "A", amountValid: true },
            { productName: "B", amountValid: false },
            { productName: "C", amountValid: false },
        ];
        const invalid = getAmountInvalidItems(items);
        expect(invalid).toHaveLength(2);
        expect(invalid.map((i) => i.productName)).toEqual(["B", "C"]);
    });

    it("amountValid 未指定（undefined）の item はブロックしない（従来クライアント互換）", () => {
        const items = [{ productName: "A" }, { productName: "B", amountValid: true }];
        expect(getAmountInvalidItems(items)).toHaveLength(0);
    });

    it("検算NG行が無ければ空配列（confirmは続行できる）", () => {
        const lines = parseCorecLines([FUJIICHI_PAGE]);
        expect(getAmountInvalidItems(lines)).toHaveLength(0);
    });

    it("検算NG行があれば検出する（confirmは400で中断すべき）", () => {
        const lines = parseCorecLines([AMOUNT_MISMATCH_PAGE]);
        expect(getAmountInvalidItems(lines)).toHaveLength(1);
    });

    it("null/非配列でも落ちない", () => {
        expect(getAmountInvalidItems([null as any, undefined as any])).toHaveLength(0);
        expect(getAmountInvalidItems(null as any)).toHaveLength(0);
    });
});

describe("parseCorecLines — 旧4970974フォーマット後方互換", () => {
    const lines = parseCorecLines([LEGACY_4970974_PAGE]);

    it("2行を抽出する", () => {
        expect(lines).toHaveLength(2);
    });

    it("品番・商品名・JAN・数量・発注単価を従来どおり抽出する", () => {
        expect(lines[0]).toMatchObject({
            hinban: "233563",
            productName: "たらこ",
            janCode: "4970974101026",
            quantity: 20,
            unitPrice: 232,
            subtotal: 4640,
            amountValid: true,
        });
        expect(lines[1]).toMatchObject({
            hinban: "233564",
            productName: "すじこ",
            janCode: "4970974101033",
            quantity: 12,
            unitPrice: 350,
            subtotal: 4200,
            amountValid: true,
        });
    });
});
