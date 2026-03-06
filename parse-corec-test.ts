import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as fs from "fs";

async function main() {
    const buf = fs.readFileSync("/Users/kaito7898/Family Business/経営管理/EdoStock/データサンプル/コレックサンプルデータ.pdf");
    const uint8 = new Uint8Array(buf);
    const doc = await getDocument({ data: uint8 }).promise;
    console.log("Pages:", doc.numPages);
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((item: any) => item.str).join(" ");
        console.log(`=== Page ${i} ===`);
        console.log(text);
    }
}
main();
