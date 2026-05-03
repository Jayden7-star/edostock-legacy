/**
 * Corec PDFパーサーのメモリプロファイリングスクリプト
 *
 * 使い方:
 *   MODE=before node --max-old-space-size=400 --import tsx parse-corec-test.ts
 *   MODE=after  node --max-old-space-size=400 --import tsx parse-corec-test.ts
 *
 * 50ms ごとに process.memoryUsage().rss をサンプリングし、ピーク値を出力する。
 *
 * 注: server/purchase-import.ts は server/index.ts から prisma を import するため、
 *      モジュール循環の関係でテストスクリプトから直接 import できない。
 *      ここでは parseCorecPDF / parseCorecLines / extractPdfText を**インラインで複製**し、
 *      MODE=before は OOM 修正前の挙動（pageTexts.join + 失敗時 extractPdfText 再呼び出し）、
 *      MODE=after は OOM 修正後の挙動（ページ単位パース + pageTexts 共有）を再現する。
 *      production コードと同期して保守すること。
 */

import * as fs from "fs";
import { PDFParse } from "pdf-parse";

const SAMPLE_PDF = "/Users/kaito7898/Family Business/経営管理/EdoStock/データサンプル/コレックサンプルデータ.pdf";
const MODE = (process.env.MODE || "after").toLowerCase();

function mb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

function normalizeJan(raw: string): string {
    return raw
        .replace(/[\s\u3000]/g, "")
        .replace(/[-‐‑‒–—―ー－]/g, "")
        .replace(/[^\d]/g, "");
}

async function extractPdfText(buffer: Buffer): Promise<string[]> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        const result = await parser.getText();
        if (result && result.pages && result.pages.length > 0) {
            const pageTexts = result.pages.map((p: any) => p.text).filter((t: string) => t.trim().length > 0);
            if (pageTexts.length > 0) return pageTexts;
        }
        if (result && result.text) {
            const pages = result.text.split('\f').filter((p: string) => p.trim().length > 0);
            if (pages.length > 0) return pages;
            return [result.text];
        }
        throw new Error("PDF解析結果が空です");
    } finally {
        await parser.destroy();
    }
}

type ParsedLine = {
    hinban: string; productName: string; janCode: string;
    spec: string; quantity: number; unitPrice: number; subtotal: number;
};

// === BEFORE: pageTexts.join(" ") で全ページ連結 → 1 つの fullText に対して 3 段階処理 ===
function parseCorecLinesBefore(pageTexts: string[]): ParsedLine[] {
    const results: ParsedLine[] = [];
    const fullText = pageTexts.join(" ");

    const lineRegex = /(\d{6})\s+([\u3000-\u9FFF\uF900-\uFAFF\w（）\s]+?)\s+(4970974[\s\-‐‑‒–—―ー－]*\d+(?:\n\d+)?)\s+(.+?)\s+(\d+)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;
    let match;
    while ((match = lineRegex.exec(fullText)) !== null) {
        const janCode = normalizeJan(match[3]);
        results.push({
            hinban: match[1],
            productName: match[2].trim(),
            janCode: janCode.length >= 13 ? janCode.substring(0, 13) : janCode,
            spec: match[4].trim(),
            quantity: parseInt(match[7]) || 0,
            unitPrice: parseInt(match[6].replace(/,/g, "")) || 0,
            subtotal: parseInt(match[8].replace(/,/g, "")) || 0,
        });
    }

    if (results.length === 0) {
        const tokens = fullText.split(/\s+/);
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
                results.push({
                    hinban,
                    productName: nameTokens.join(" ").trim(),
                    janCode: janCode.substring(0, 13),
                    spec: "",
                    quantity, unitPrice, subtotal,
                });
            }
        }
    }

    if (results.length === 0) {
        const orderRegex = /(\d{6})\s+(.+?)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;
        let orderMatch;
        while ((orderMatch = orderRegex.exec(fullText)) !== null) {
            const hinban = orderMatch[1];
            const productName = orderMatch[2].replace(/\s{2,}/g, " ").trim();
            const unitPrice = parseInt(orderMatch[3].replace(/,/g, "")) || 0;
            const quantity = parseInt(orderMatch[4]) || 0;
            const subtotal = parseInt(orderMatch[5].replace(/,/g, "")) || 0;
            if (quantity > 0) {
                results.push({ hinban, productName, janCode: "", spec: "", quantity, unitPrice, subtotal });
            }
        }
    }

    return results;
}

// === AFTER: ページ単位処理。fullText 連結を廃止 ===
function parseCorecLinesAfter(pageTexts: string[]): ParsedLine[] {
    const results: ParsedLine[] = [];

    // Stage 1: 主正規表現をページ単位で適用
    const lineRegex = /(\d{6})\s+([\u3000-\u9FFF\uF900-\uFAFF\w（）\s]+?)\s+(4970974[\s\-‐‑‒–—―ー－]*\d+(?:\n\d+)?)\s+(.+?)\s+(\d+)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;
    for (const pageText of pageTexts) {
        lineRegex.lastIndex = 0;
        let match;
        while ((match = lineRegex.exec(pageText)) !== null) {
            const janCode = normalizeJan(match[3]);
            results.push({
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

    // Stage 2: トークンベース（ページ単位）
    if (results.length === 0) {
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
                    results.push({
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

    // Stage 3: 発注書フォーマット（ページ単位）
    if (results.length === 0) {
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
                    results.push({ hinban, productName, janCode: "", spec: "", quantity, unitPrice, subtotal });
                }
            }
        }
    }

    return results;
}

async function runBefore(buffer: Buffer, forceFail = false) {
    // Before: 1 回目パース → 0 件なら extractPdfText を再呼び出し（pdfjs 二重起動）
    const pageTexts = await extractPdfText(buffer);
    let items = forceFail ? [] : parseCorecLinesBefore(pageTexts);
    if (items.length === 0) {
        // 失敗時の再パース経路（OOM の元凶）— pdfjs を 2 度起動
        const pageTexts2 = await extractPdfText(buffer);
        void pageTexts2;
        items = [];
    }
    return items;
}

async function runAfter(buffer: Buffer, forceFail = false) {
    // After: 1 回パースした pageTexts を使い回す（再パースなし）
    const pageTexts = await extractPdfText(buffer);
    const items = forceFail ? [] : parseCorecLinesAfter(pageTexts);
    // 失敗時も pageTexts は既に手元にあるので再パース不要
    return { items, pageTexts };
}

async function main() {
    const buf = fs.readFileSync(SAMPLE_PDF);
    console.log(`MODE: ${MODE}`);
    console.log(`PDF size: ${mb(buf.length)} (${buf.length} bytes)`);

    let peakRss = 0;
    let samples = 0;
    const start = process.memoryUsage().rss;
    console.log(`Start RSS: ${mb(start)}`);

    const sampler = setInterval(() => {
        const rss = process.memoryUsage().rss;
        if (rss > peakRss) peakRss = rss;
        samples++;
    }, 50);

    const t0 = Date.now();
    let items: ParsedLine[];
    if (MODE === "before") {
        items = await runBefore(buf, false);
    } else if (MODE === "before-fail") {
        items = await runBefore(buf, true);
    } else if (MODE === "after-fail") {
        const r = await runAfter(buf, true);
        items = r.items;
    } else {
        const r = await runAfter(buf, false);
        items = r.items;
    }
    const elapsed = Date.now() - t0;

    clearInterval(sampler);
    const after = process.memoryUsage().rss;
    if (after > peakRss) peakRss = after;

    console.log(`Parsed items: ${items.length}`);
    console.log(`Elapsed: ${elapsed}ms`);
    console.log(`Samples: ${samples}`);
    console.log(`After RSS: ${mb(after)}`);
    console.log(`Peak RSS:  ${mb(peakRss)}`);
    console.log(`Delta:     ${mb(peakRss - start)}`);
    console.log(`First 3 items:`);
    items.slice(0, 3).forEach((it: ParsedLine, i: number) => {
        console.log(`  [${i}] hinban=${it.hinban} name=${it.productName} jan=${it.janCode} qty=${it.quantity} price=${it.unitPrice}`);
    });

    const outPath = process.env.PARSE_DUMP_PATH;
    if (outPath) {
        // 比較用に主要フィールドのみダンプ（spec/subtotal はインライン版のみ計算）
        const dump = items.map((i) => ({
            hinban: i.hinban,
            productName: i.productName,
            janCode: i.janCode,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
        }));
        fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
        console.log(`Dumped to: ${outPath}`);
    }
}

main().catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
});
