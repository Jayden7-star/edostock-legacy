/**
 * 適正在庫計算スクリプト
 * Render Shell で直接実行: node scripts/calculate-optimal-stock.js
 *
 * 計算ロジック:
 *   1. 終売自動判定: REGULAR商品で過去に販売実績があり直近3ヶ月で販売0 → DISCONTINUED
 *   2. DISCONTINUED商品は適正在庫計算から除外
 *   3. 販売実績がある月のみで平均を取る（0の月は除外）
 *   4. avg_daily_sales = 月間販売数 / その月の日数（実績のある月のみ）
 *   5. safety_factor: FOOD=1.2, APPAREL=1.5, GOODS=1.5, 不明=1.3
 *   6. optimal_stock = ceil(avg_daily_sales × 月日数 × safety_factor)
 *   7. 12ヶ月分を monthly_optimal_stock に upsert
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 月の日数
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// カテゴリ別安全係数
function safetyFactor(department) {
  switch (department) {
    case 'FOOD': return 1.2;
    case 'APPAREL': return 1.5;
    case 'GOODS': return 1.5;
    default: return 1.3;
  }
}

async function main() {
  const targetYear = 2026;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  console.log('='.repeat(60));
  console.log('  適正在庫計算スクリプト（改善版）');
  console.log(`  対象年: ${targetYear}  実行日: ${now.toISOString().slice(0, 10)}`);
  console.log('='.repeat(60));

  // ── 0. 終売自動判定 ──
  // 対象: sales_type が REGULAR の商品のみ
  // 条件: 過去に販売実績があり、直近3ヶ月で販売0
  console.log('\n── 終売自動判定 ──');

  const threeMonthsAgo = new Date(targetYear, currentMonth - 3, 1);

  const regularProducts = await prisma.product.findMany({
    where: { isActive: true, salesType: 'REGULAR' },
    select: { id: true, name: true, janCode: true },
  });

  const discontinuedList = [];

  for (const prod of regularProducts) {
    // 過去に販売実績があるか
    const pastSales = await prisma.salesRecord.findFirst({
      where: { productId: prod.id, quantitySold: { gt: 0 } },
    });
    if (!pastSales) continue; // 販売実績なし → スキップ

    // 直近3ヶ月に販売があるか
    const recentSales = await prisma.salesRecord.findFirst({
      where: {
        productId: prod.id,
        periodStart: { gte: threeMonthsAgo },
        quantitySold: { gt: 0 },
      },
    });
    if (!recentSales) {
      // 直近3ヶ月で販売0 → DISCONTINUED に更新
      await prisma.product.update({
        where: { id: prod.id },
        data: { salesType: 'DISCONTINUED' },
      });
      discontinuedList.push(prod);
    }
  }

  console.log(`  終売判定された商品数: ${discontinuedList.length}`);
  if (discontinuedList.length > 0) {
    for (const p of discontinuedList) {
      console.log(`    - ${p.name} (JAN: ${p.janCode})`);
    }
  } else {
    console.log('  （該当商品なし）');
  }

  // ── 1. 販売実績がある商品を特定（DISCONTINUED除外）──
  const allSalesForActive = await prisma.salesRecord.findMany({
    where: { quantitySold: { gt: 0 } },
    select: { productId: true },
  });
  const allActiveProductIds = [...new Set(allSalesForActive.map(r => r.productId))];

  if (allActiveProductIds.length === 0) {
    console.log('\n販売実績のある商品がありません。');
    await prisma.$disconnect();
    return;
  }

  // ── 2. 対象商品をカテゴリ付きで取得（DISCONTINUED除外）──
  const products = await prisma.product.findMany({
    where: {
      id: { in: allActiveProductIds },
      isActive: true,
      salesType: { not: 'DISCONTINUED' },
    },
    include: { category: true },
    orderBy: { name: 'asc' },
  });

  // カテゴリ別内訳
  const deptCount = {};
  for (const p of products) {
    const dept = p.category.department;
    deptCount[dept] = (deptCount[dept] || 0) + 1;
  }

  console.log(`\n対象商品数: ${products.length}（DISCONTINUED除外済み）`);
  console.log('カテゴリ別内訳:');
  for (const [dept, count] of Object.entries(deptCount)) {
    const sf = safetyFactor(dept);
    console.log(`  ${dept}: ${count}商品 (safety_factor=${sf})`);
  }

  // ── 3. 全販売データを取得 (quantity_sold > 0 で discount 除外) ──
  const allSales = await prisma.salesRecord.findMany({
    where: {
      productId: { in: products.map(p => p.id) },
      quantitySold: { gt: 0 },
    },
  });

  console.log(`\n販売レコード数: ${allSales.length}`);

  // ── 4. 商品ごとに計算して upsert ──
  // 改善: 販売実績がある月のみで平均を取る
  let upsertCount = 0;
  const sampleResults = []; // サンプル表示用

  await prisma.$transaction(async (tx) => {
    for (const product of products) {
      const dept = product.category.department;
      const sf = safetyFactor(dept);
      const productSales = allSales.filter(r => r.productId === product.id);

      // 全月のデータを集計: month → Map<year, totalQty>
      const monthYearMap = new Map();
      for (let m = 1; m <= 12; m++) {
        monthYearMap.set(m, new Map());
      }
      for (const rec of productSales) {
        const recMonth = rec.periodStart.getMonth() + 1;
        const y = rec.periodStart.getFullYear();
        const yearMap = monthYearMap.get(recMonth);
        yearMap.set(y, (yearMap.get(y) || 0) + rec.quantitySold);
      }

      // 販売実績がある月のみで日販平均を計算
      const monthsWithSales = [];
      for (let m = 1; m <= 12; m++) {
        const yearMap = monthYearMap.get(m);
        if (yearMap.size > 0) {
          const totalQty = [...yearMap.values()].reduce((a, b) => a + b, 0);
          const avgMonthlyQty = totalQty / yearMap.size;
          const days = daysInMonth(targetYear, m);
          const avgDailySales = avgMonthlyQty / days;
          monthsWithSales.push({ month: m, avgDailySales });
        }
      }

      // 全月の平均日販（実績がある月のみの平均）
      let globalAvgDaily = 0;
      if (monthsWithSales.length > 0) {
        globalAvgDaily = monthsWithSales.reduce((sum, ms) => sum + ms.avgDailySales, 0) / monthsWithSales.length;
      }

      const monthlyData = [];

      for (let m = 1; m <= 12; m++) {
        const days = daysInMonth(targetYear, m);
        const yearMap = monthYearMap.get(m);

        let avgDailySales = 0;
        if (yearMap.size > 0) {
          // その月に実績がある → その月のデータで計算
          const totalQty = [...yearMap.values()].reduce((a, b) => a + b, 0);
          const avgMonthlyQty = totalQty / yearMap.size;
          avgDailySales = avgMonthlyQty / days;
        }
        // 実績がない月は avgDailySales = 0 のまま（適正在庫0）

        const optimal = Math.ceil(avgDailySales * days * sf);

        await tx.monthlyOptimalStock.upsert({
          where: {
            productId_year_month: {
              productId: product.id,
              year: targetYear,
              month: m,
            },
          },
          update: {
            avgDailySales,
            safetyFactor: sf,
            optimalStock: optimal,
            calculatedAt: new Date(),
          },
          create: {
            productId: product.id,
            year: targetYear,
            month: m,
            avgDailySales,
            safetyFactor: sf,
            optimalStock: optimal,
            calculatedAt: new Date(),
          },
        });

        upsertCount++;
        monthlyData.push({ month: m, days, avgDailySales, optimal, hasSales: yearMap.size > 0 });
      }

      // サンプル3商品を収集
      if (sampleResults.length < 3) {
        sampleResults.push({ product, dept, sf, monthlyData });
      }
    }
  }, { timeout: 120000 });

  // ── 5. 結果出力 ──
  console.log(`\nupsert 完了: ${upsertCount} レコード (${products.length}商品 × 12ヶ月)`);

  // サンプル3商品の月別適正在庫
  console.log('\n' + '='.repeat(60));
  console.log('  サンプル商品の月別適正在庫');
  console.log('='.repeat(60));

  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  for (const s of sampleResults) {
    console.log(`\n▸ ${s.product.name} (JAN: ${s.product.janCode})`);
    console.log(`  カテゴリ: ${s.product.category.name} / ${s.dept}  safety_factor: ${s.sf}`);
    console.log(`  販売タイプ: ${s.product.salesType}`);
    console.log('  ' + '-'.repeat(56));
    console.log('  月     | 日数 | 日販平均 | 適正在庫 | 実績');
    console.log('  ' + '-'.repeat(56));
    for (const d of s.monthlyData) {
      const mLabel = monthNames[d.month - 1].padEnd(4, '　');
      const daysStr = String(d.days).padStart(3);
      const avgStr = d.avgDailySales.toFixed(2).padStart(8);
      const optStr = String(d.optimal).padStart(8);
      const salesFlag = d.hasSales ? '  ●' : '  -';
      console.log(`  ${mLabel} | ${daysStr}  | ${avgStr} | ${optStr} |${salesFlag}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  完了');
  console.log('='.repeat(60));
}

main()
  .catch((e) => {
    console.error('エラー:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
