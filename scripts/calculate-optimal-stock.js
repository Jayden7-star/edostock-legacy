/**
 * 適正在庫計算スクリプト
 * Render Shell で直接実行: node scripts/calculate-optimal-stock.js
 *
 * 計算ロジック:
 *   1. 直近3ヶ月（2026年2月〜4月）に販売実績がある商品を特定
 *   2. 各月の販売数を period_start の月で集計
 *   3. 同じ月のデータが複数年ある場合は平均
 *   4. avg_daily_sales = 月間販売数 / その月の日数
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

  console.log('='.repeat(60));
  console.log('  適正在庫計算スクリプト');
  console.log(`  対象年: ${targetYear}  実行日: ${new Date().toISOString().slice(0, 10)}`);
  console.log('='.repeat(60));

  // ── 1. 直近3ヶ月に販売実績がある商品を特定 ──
  // 2026年2月〜4月
  const recentStart = new Date(2026, 1, 1); // 2026-02-01
  const recentEnd = new Date(2026, 4, 1);   // 2026-05-01 (未満)

  const recentSales = await prisma.salesRecord.findMany({
    where: {
      periodStart: { gte: recentStart, lt: recentEnd },
      quantitySold: { gt: 0 },
    },
    select: { productId: true },
  });

  const activeProductIds = [...new Set(recentSales.map(r => r.productId))];

  if (activeProductIds.length === 0) {
    console.log('\n直近3ヶ月に販売実績のある商品がありません。');
    await prisma.$disconnect();
    return;
  }

  // ── 2. 対象商品をカテゴリ付きで取得 ──
  const products = await prisma.product.findMany({
    where: { id: { in: activeProductIds }, isActive: true },
    include: { category: true },
    orderBy: { name: 'asc' },
  });

  // カテゴリ別内訳
  const deptCount = {};
  for (const p of products) {
    const dept = p.category.department;
    deptCount[dept] = (deptCount[dept] || 0) + 1;
  }

  console.log(`\n対象商品数: ${products.length}`);
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
  let upsertCount = 0;
  const sampleResults = []; // サンプル表示用

  await prisma.$transaction(async (tx) => {
    for (const product of products) {
      const dept = product.category.department;
      const sf = safetyFactor(dept);
      const productSales = allSales.filter(r => r.productId === product.id);

      const monthlyData = [];

      for (let m = 1; m <= 12; m++) {
        const days = daysInMonth(targetYear, m);

        // 該当月のレコードを年別にグループ化
        const yearMap = new Map();
        for (const rec of productSales) {
          const recMonth = rec.periodStart.getMonth() + 1;
          if (recMonth !== m) continue;
          const y = rec.periodStart.getFullYear();
          yearMap.set(y, (yearMap.get(y) || 0) + rec.quantitySold);
        }

        let avgDailySales = 0;
        if (yearMap.size > 0) {
          const totalQty = [...yearMap.values()].reduce((a, b) => a + b, 0);
          const avgMonthlyQty = totalQty / yearMap.size;
          avgDailySales = avgMonthlyQty / days;
        }

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
        monthlyData.push({ month: m, days, avgDailySales, optimal });
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
    console.log('  ' + '-'.repeat(56));
    console.log('  月     | 日数 | 日販平均 | 適正在庫');
    console.log('  ' + '-'.repeat(56));
    for (const d of s.monthlyData) {
      const mLabel = monthNames[d.month - 1].padEnd(4, '　');
      const daysStr = String(d.days).padStart(3);
      const avgStr = d.avgDailySales.toFixed(2).padStart(8);
      const optStr = String(d.optimal).padStart(8);
      console.log(`  ${mLabel} | ${daysStr}  | ${avgStr} | ${optStr}`);
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
