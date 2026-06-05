// server/corec-parser.ts
// コレック(COREC)発注書PDFの抽出テキスト → 商品明細行パーサー。
//
// 設計方針:
//  - I/O を含まない純粋関数のみを置く（pdf-parse / prisma / express に一切依存しない）。
//    server/index.ts は読み込み時に PrismaClient と Express app を初期化する副作用を持つため、
//    そこに依存するとユニットテストから安全に import できない。本モジュールは自己完結。
//  - PDFテキスト抽出 (extractPdfText) と DB マッチング (corec/parse) は purchase-import.ts に残す。

// 各種ハイフン/ダッシュ（半角・全角・各種長音/マイナス）をまとめて扱うための文字クラス本体。
const DASH_CHARS = "\\-‐‑‒–—―ー－";

export interface CorecParsedLine {
    hinban: string;
    productName: string;
    janCode: string;
    spec: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;     // PDF上の「発注金額」（検算の基準値）
    amountValid: boolean; // 発注単価 × 数量 === 発注金額 か（検算不能なら true）
}

/**
 * JANコードの正規化。空白(半角/全角)・各種ハイフン・改行・非数字を除去して数字のみにする。
 * 例: "4589950-\n119742" → "4589950119742"
 */
export function normalizeJan(raw: string): string {
    return raw
        .replace(/[\s　]/g, "")
        .replace(new RegExp(`[${DASH_CHARS}]`, "g"), "")
        .replace(/[^\d]/g, "");
}

/**
 * 発注単価 × 数量 = 発注金額 の検算。
 * 3値がすべて正のときのみ厳密一致を要求する。いずれかが 0（取得できなかった）の場合は
 * 検算不能とみなし true を返す（＝行を落とさず通す）。
 */
export function isAmountConsistent(unitPrice: number, quantity: number, subtotal: number): boolean {
    if (unitPrice > 0 && quantity > 0 && subtotal > 0) {
        return unitPrice * quantity === subtotal;
    }
    return true;
}

/**
 * 確定（在庫加算）前の安全弁。検算に失敗した行（amountValid === false）だけを抽出する。
 * - 厳密に `=== false` のみを対象にする。amountValid 未指定（undefined）の item は
 *   従来クライアント互換のため対象外（＝ブロックしない）。
 * 呼び出し側（/corec/confirm）はこの結果が空でなければ 400 で処理を中断する。
 */
export function getAmountInvalidItems<T extends { amountValid?: boolean }>(items: T[]): T[] {
    if (!Array.isArray(items)) return [];
    return items.filter((it) => it != null && it.amountValid === false);
}

type RawLine = Omit<CorecParsedLine, "amountValid">;

/**
 * JAN直前の領域から商品名（と任意の先頭品番）を取り出す。
 * - 商品名は「JANと同じ論理行の左側」に来るため、領域を改行で分割した最後の非空行を採用する。
 * - 行頭に品番(6桁)があれば分離する（旧フォーマット後方互換）。
 * - 全角/半角の空白連続を半角空白1個へ圧縮する。
 */
function extractNameAndHinban(region: string): { hinban: string; productName: string } {
    const lines = region.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    let name = lines.length > 0 ? lines[lines.length - 1] : region.trim();
    let hinban = "";
    const m = name.match(/^(\d{6})[\s　]+(.+)$/);
    if (m) {
        hinban = m[1];
        name = m[2];
    }
    name = name.replace(/[\s　]+/g, " ").trim();
    return { hinban, productName: name };
}

/**
 * コレックPDFの各ページテキストから商品明細行を抽出する。
 *
 * 多段フォールバック（先に当たった段で確定し、後段は results が空のときだけ走る）:
 *  Stage 1: 旧フォーマット（品番6桁 + JAN先頭4970974）の主正規表現
 *  Stage 2: 汎用 JAN アンカー（品番空欄/任意JAN先頭に対応）  ← 藤一フォーマット用
 *  Stage 3: トークンベース（旧4970974）
 *  Stage 4: 発注書フォーマット（品番6桁・JANなし）
 *
 * OOM対策のため全ページ連結はせず、各段でページ単位に処理する。
 */
export function parseCorecLines(pageTexts: string[]): CorecParsedLine[] {
    const raw: RawLine[] = [];

    // Stage 1: COREC 注文行の正規表現（旧フォーマット）
    // "233563   たらこ   4970974- 101026   70g 築地   10   ¥232   20   対 象   ¥4,640"
    // JANコードが改行をまたぐ場合に対応: "4970974‐10\n0661" → \d+(?:\n\d+)? でキャプチャ
    const lineRegex = /(\d{6})\s+([　-鿿豈-﫿\w（）\s]+?)\s+(4970974[\s\-‐‑‒–—―ー－]*\d+(?:\n\d+)?)\s+(.+?)\s+(\d+)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;
    for (const pageText of pageTexts) {
        lineRegex.lastIndex = 0;
        let match;
        while ((match = lineRegex.exec(pageText)) !== null) {
            const janCode = normalizeJan(match[3]);
            raw.push({
                hinban: match[1],
                productName: match[2].trim(),
                janCode: janCode.length >= 13 ? janCode.substring(0, 13) : janCode,
                spec: match[4].trim(),
                quantity: parseInt(match[7]) || 0,
                unitPrice: parseInt(match[6].replace(/,/g, "")) || 0,
                subtotal: parseInt(match[8].replace(/,/g, "")) || 0,
            });
        }
    }

    // Stage 2: 汎用 JAN アンカー（品番空欄 / 任意のJAN先頭に対応）
    // 旧Stage1（4970974固定・品番必須）で1件も取れなかった発注書フォーマット向け。藤一PDFはここで拾う。
    // アンカー = 「7桁+6桁で構成されるJAN」 と 行末の「¥発注単価 数量 対象 ¥発注金額」。
    // JANはハイフン/全角/空白/改行で 7-6 に分割されうるため [DASH/空白]* で吸収する。
    // 商品名はJAN直前の領域から取り出す（規格・入数・発注単価は商品名に含めない）。
    if (raw.length === 0) {
        const janRowRegex = new RegExp(
            `(\\d{7})[${DASH_CHARS}\\s　]*(\\d{6})\\s+(.+?)\\s*[¥￥]([\\d,]+)\\s+(\\d+)\\s+対\\s*象\\s+[¥￥]([\\d,]+)`,
            "g"
        );
        for (const pageText of pageTexts) {
            janRowRegex.lastIndex = 0;
            let match;
            let prevEnd = 0;
            while ((match = janRowRegex.exec(pageText)) !== null) {
                const janCode = normalizeJan(match[1] + match[2]);
                // 13桁JANにならないものは誤検出（電話番号・金額の連結等）としてスキップ。
                // prevEnd は更新し、後続行の商品名領域がこの誤検出位置から始まるようにする。
                if (janCode.length !== 13) {
                    prevEnd = janRowRegex.lastIndex;
                    continue;
                }
                const region = pageText.slice(prevEnd, match.index);
                const { hinban, productName } = extractNameAndHinban(region);
                raw.push({
                    hinban,
                    productName,
                    janCode,
                    spec: match[3].trim(),
                    quantity: parseInt(match[5]) || 0,
                    unitPrice: parseInt(match[4].replace(/,/g, "")) || 0,
                    subtotal: parseInt(match[6].replace(/,/g, "")) || 0,
                });
                prevEnd = janRowRegex.lastIndex;
            }
        }
    }

    // Stage 3: トークンベースのフォールバック（旧4970974・ページ単位）
    if (raw.length === 0) {
        for (const pageText of pageTexts) {
            const tokens = pageText.split(/\s+/);
            for (let i = 0; i < tokens.length; i++) {
                if (!/^\d{6}$/.test(tokens[i])) continue;
                const hinban = tokens[i];

                const nameTokens: string[] = [];
                let j = i + 1;
                while (j < tokens.length && !tokens[j].startsWith("4970974")) {
                    nameTokens.push(tokens[j]);
                    j++;
                }
                if (j >= tokens.length) continue;

                const janTokens: string[] = [];
                while (j < tokens.length) {
                    const cleaned = tokens[j].replace(/[\s\-‐‑‒–—―ー－]/g, "");
                    if (/^\d+$/.test(cleaned) || tokens[j].startsWith("4970974")) {
                        janTokens.push(tokens[j]);
                        j++;
                        if (normalizeJan(janTokens.join("")).length >= 13) break;
                    } else break;
                }
                const janCode = normalizeJan(janTokens.join(""));

                let quantity = 0, unitPrice = 0, subtotal = 0;
                for (let k = j; k < Math.min(j + 12, tokens.length); k++) {
                    const costMatch = tokens[k].match(/^[¥￥]([\d,]+)$/);
                    if (costMatch && unitPrice === 0) {
                        unitPrice = parseInt(costMatch[1].replace(/,/g, "")) || 0;
                        if (k + 1 < tokens.length && /^\d+$/.test(tokens[k + 1])) {
                            quantity = parseInt(tokens[k + 1]) || 0;
                        }
                    } else if (costMatch && unitPrice > 0 && k > j + 3) {
                        subtotal = parseInt(costMatch[1].replace(/,/g, "")) || 0;
                    }
                }

                if (janCode.length >= 7 && quantity > 0) {
                    raw.push({
                        hinban,
                        productName: nameTokens.join(" ").trim(),
                        janCode: janCode.substring(0, 13),
                        spec: "",
                        quantity, unitPrice, subtotal,
                    });
                }
            }
        }
    }

    // Stage 4: 発注書フォーマット（JANコードなし、ページ単位）
    // パターン: 品番(6桁) + 商品名 + ¥単価 + 数量 + 対象 + ¥金額
    if (raw.length === 0) {
        const orderRegex = /(\d{6})\s+(.+?)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;
        for (const pageText of pageTexts) {
            orderRegex.lastIndex = 0;
            let orderMatch;
            while ((orderMatch = orderRegex.exec(pageText)) !== null) {
                const hinban = orderMatch[1];
                const productName = orderMatch[2].replace(/\s{2,}/g, " ").trim();
                const unitPrice = parseInt(orderMatch[3].replace(/,/g, "")) || 0;
                const quantity = parseInt(orderMatch[4]) || 0;
                const subtotal = parseInt(orderMatch[5].replace(/,/g, "")) || 0;

                if (quantity > 0) {
                    raw.push({
                        hinban,
                        productName,
                        janCode: "",  // JANコードなし — 品番でフォールバック検索
                        spec: "",
                        quantity,
                        unitPrice,
                        subtotal,
                    });
                }
            }
        }
    }

    return raw.map((r) => ({
        ...r,
        amountValid: isAmountConsistent(r.unitPrice, r.quantity, r.subtotal),
    }));
}
