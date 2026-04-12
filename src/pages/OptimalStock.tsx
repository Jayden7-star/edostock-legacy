import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { BarChart3, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface OptimalStockRecord {
  productId: number;
  optimalStock: number;
  avgDailySales: number;
  safetyFactor: number;
  stockDifference: number;
  isUnderstocked: boolean;
  product: {
    id: number;
    name: string;
    janCode: string;
    currentStock: number;
    reorderPoint: number;
    salesType: string;
    category: { name: string; department: string };
  };
}

const salesTypes = [
  { value: "ALL", label: "すべて" },
  { value: "REGULAR", label: "通年販売" },
  { value: "SEASONAL", label: "季節限定" },
  { value: "WEATHER", label: "天候依存" },
  { value: "DISCONTINUED", label: "終売" },
];

const departments = [
  { value: "ALL", label: "すべて" },
  { value: "FOOD", label: "食品" },
  { value: "APPAREL", label: "アパレル" },
  { value: "GOODS", label: "雑貨" },
];

const salesTypeLabel = (type: string) => {
  const map: Record<string, string> = { REGULAR: "通年", SEASONAL: "季節", WEATHER: "天候", DISCONTINUED: "終売" };
  return map[type] || type;
};

const salesTypeBadgeColor = (type: string) => {
  switch (type) {
    case "REGULAR": return "bg-green-500/15 text-green-400 border-green-500/30";
    case "SEASONAL": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "WEATHER": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "DISCONTINUED": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "";
  }
};

const statusLabel = (currentStock: number, optimalStock: number) => {
  if (optimalStock === 0) return { text: "-", color: "text-muted-foreground" };
  const ratio = currentStock / optimalStock;
  if (ratio < 0.8) return { text: "不足", color: "text-red-400" };
  if (ratio > 1.3) return { text: "過剰", color: "text-yellow-400" };
  return { text: "適正", color: "text-green-400" };
};

const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

const OptimalStock = () => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState<OptimalStockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [salesTypeFilter, setSalesTypeFilter] = useState("ALL");
  const [calculating, setCalculating] = useState(false);
  const { toast } = useToast();

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/optimal-stock/month/${year}/${month}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setRecords(data.results || []);
      })
      .catch(() => toast({ title: "エラー", description: "適正在庫データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [year, month, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await fetch("/api/optimal-stock/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ year }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "計算完了",
          description: `${data.calculatedCount}商品の適正在庫を計算しました${data.discontinuedCount > 0 ? `（終売判定: ${data.discontinuedCount}件）` : ""}`,
        });
        fetchData();
      } else {
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setCalculating(false);
    }
  };

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  const filtered = records.filter((r) => {
    if (deptFilter !== "ALL" && r.product.category.department !== deptFilter) return false;
    if (salesTypeFilter !== "ALL" && r.product.salesType !== salesTypeFilter) return false;
    return true;
  });

  const understocked = filtered.filter((r) => r.isUnderstocked).length;
  const overstocked = filtered.filter((r) => r.optimalStock > 0 && r.product.currentStock / r.optimalStock > 1.3).length;

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">適正在庫一覧</h1>
        </div>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={handleCalculate} disabled={calculating}>
          {calculating ? "計算中..." : "再計算"}
        </Button>
      </motion.div>

      {/* フィルター & 月切替 */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="glass-card p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-medium text-sm min-w-[80px] text-center">{year}年{monthNames[month - 1]}</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="bg-secondary/50 border-border/50 h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={salesTypeFilter} onValueChange={setSalesTypeFilter}>
            <SelectTrigger className="bg-secondary/50 border-border/50 h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {salesTypes.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 ml-auto text-xs">
          <span className="text-muted-foreground">{filtered.length}商品</span>
          {understocked > 0 && <Badge variant="outline" className="text-red-400 border-red-500/30">{understocked}件 不足</Badge>}
          {overstocked > 0 && <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">{overstocked}件 過剰</Badge>}
        </div>
      </motion.div>

      {/* テーブル */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card overflow-hidden">
        {loading ? (
          <div className="space-y-4 p-5">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 shimmer rounded" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium">JAN</th>
                  <th className="text-left py-3 px-4 font-medium">商品名</th>
                  <th className="text-left py-3 px-4 font-medium">カテゴリ</th>
                  <th className="text-left py-3 px-4 font-medium">販売タイプ</th>
                  <th className="text-right py-3 px-4 font-medium">現在庫</th>
                  <th className="text-right py-3 px-4 font-medium">適正在庫</th>
                  <th className="text-right py-3 px-4 font-medium">差分</th>
                  <th className="text-right py-3 px-4 font-medium">日販平均</th>
                  <th className="text-center py-3 px-4 font-medium">ステータス</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const status = statusLabel(r.product.currentStock, r.optimalStock);
                  return (
                    <tr key={r.productId}
                      className={`border-b border-border/30 hover:bg-secondary/30 transition-colors ${r.isUnderstocked ? "bg-red-500/5" : ""}`}>
                      <td className="py-3 px-4 font-num text-xs text-muted-foreground">{r.product.janCode}</td>
                      <td className="py-3 px-4 font-medium">{r.product.name}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="text-xs">{r.product.category.name}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={`text-[11px] ${salesTypeBadgeColor(r.product.salesType)}`}>
                          {salesTypeLabel(r.product.salesType)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-num">{r.product.currentStock}</td>
                      <td className="py-3 px-4 text-right font-num font-semibold">{r.optimalStock}</td>
                      <td className={`py-3 px-4 text-right font-num ${r.stockDifference < 0 ? "text-red-400" : r.stockDifference > 0 ? "text-green-400" : ""}`}>
                        {r.stockDifference > 0 ? `+${r.stockDifference}` : r.stockDifference}
                      </td>
                      <td className="py-3 px-4 text-right font-num text-xs text-muted-foreground">
                        {r.avgDailySales.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs font-semibold ${status.color}`}>{status.text}</span>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground">
                      <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>適正在庫データがありません</p>
                      <p className="text-xs mt-1">「再計算」ボタンを押して計算してください</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default OptimalStock;
