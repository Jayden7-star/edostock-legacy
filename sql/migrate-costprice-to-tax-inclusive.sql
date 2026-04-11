-- ============================================================
-- 原価（costPrice）を税抜→税込に一括変換
-- 実行環境: Render Shell (SQLite)
-- 実行前に必ずバックアップを取得すること
-- ============================================================

-- 確認用: 変換前の状態を確認
-- SELECT p.id, p.name, p.cost_price, c.department, c.is_food
-- FROM products p JOIN categories c ON p.category_id = c.id
-- WHERE p.cost_price > 0;

-- FOOD部門: 軽減税率 8%
UPDATE products
SET cost_price = ROUND(cost_price * 1.08)
WHERE cost_price > 0
  AND category_id IN (
    SELECT id FROM categories WHERE department = 'FOOD'
  );

-- APPAREL部門: 標準税率 10%
UPDATE products
SET cost_price = ROUND(cost_price * 1.10)
WHERE cost_price > 0
  AND category_id IN (
    SELECT id FROM categories WHERE department = 'APPAREL'
  );

-- GOODS部門: 標準税率 10%
UPDATE products
SET cost_price = ROUND(cost_price * 1.10)
WHERE cost_price > 0
  AND category_id IN (
    SELECT id FROM categories WHERE department = 'GOODS'
  );

-- 確認用: 変換後の状態を確認
-- SELECT p.id, p.name, p.cost_price, c.department, c.is_food
-- FROM products p JOIN categories c ON p.category_id = c.id
-- WHERE p.cost_price > 0;
