import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Play, CheckCircle, AlertTriangle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CountItem {
  id: number;
  productId: number;
  theoreticalStock: number;
  actualStock: number | null;
  discrepancy: number | null;
  reason: string;
  note: string | null;
  product: {
    id: number;
    name: string;
    janCode: string;
    category: { displayName: string };
  };
}

interface StocktakeDetail {
  id: number;
  stocktakeDate: string;
  status: string;
  totalProducts: number;
  discrepancyCount: number;
  counts: CountItem[];
}

interface HistoryItem {
  id: number;
  stocktakeDate: string;
  status: string;
  totalProducts: number;
  discrepancyCount: number;
  startedAt: string;
  completedAt: string | null;
  user: { name: string };
}

const reasons = [
  { value: "NONE", label: "なし" },
  { value: "COUNT_ERROR", label: "数え間違い" },
  { value: "DAMAGE", label: "破損" },
  { value: "THEFT", label: "盗難" },
  { value: "UNKNOWN", label: "不明" },
];

const Stocktake = () => {
  const [stocktakeId, setStocktakeId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [dateValue, setDateValue] = useState(new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  // Fetch history
  const fetchHistory = useCallback(() => {
    fetch("/api/stocktakes", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setHistory(data);
        // Check if there's an in-progress stocktake
        const inProgress = data.find((s: HistoryItem) => s.status === "IN_PROGRESS");
        if (inProgress) {
          setStocktakeId(inProgress.id);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch stocktake detail
  const fetchDetail = useCallback((id: number) => {
    fetch(`/api/stocktakes/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setDetail);
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (stocktakeId) fetchDetail(stocktakeId);
  }, [stocktakeId, fetchDetail]);

  // Start stocktake
  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stocktakeDate: dateValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setStocktakeId(data.id);
        toast({ title: "棚卸し開始", description: `${data.totalProducts}品目の棚卸しを開始しました` });
      } else {
        if (data.stocktakeId) {
          setStocktakeId(data.stocktakeId);
          toast({ title: "進行中の棚卸し", description: "既に進行中の棚卸しがあります。続きから入力できます。" });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  // Save actual stock for a product
  const handleCountUpdate = async (productId: number, actualStock: string, reason?: string) => {
    if (!stocktakeId) return;
    const actual = actualStock === "" ? null : parseInt(actualStock);
    try {
      await fetch(`/api/stocktakes/${stocktakeId}/counts/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ actualStock: actual, reason }),
      });
      fetchDetail(stocktakeId);
    } catch {
      // silent — user will see unsaved state
    }
  };

  // Complete stocktake
  const handleComplete = async () => {
    if (!stocktakeId || !confirm("棚卸しを確定しますか？\n確定すると在庫数が実在庫に更新されます。")) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/stocktakes/${stocktakeId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "棚卸し完了",
          description: `差異商品: ${data.discrepancyCount}件`,
        });
        setStocktakeId(null);
        setDetail(null);
        fetchHistory();
      } else {
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  // Derived data
  const counts = detail?.counts || [];
  const categoriesMap = new Map<string, CountItem[]>();
  counts.forEach((c) => {
    const cat = c.product.category.displayName;
    if (!categoriesMap.has(cat)) categoriesMap.set(cat, []);
    categoriesMap.get(cat)!.push(c);
  });
  const categories = Array.from(categoriesMap.keys());
  const completed = counts.filter((c) => c.actualStock !== null).length;
  const total = counts.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-20 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!stocktakeId ? (
        <>
          {/* 開始画面 */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
              <ClipboardList className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">棚卸しを開始</h2>
            <p className="text-muted-foreground mb-6">全商品の実在庫数を入力し、理論在庫との差異を確認します</p>
            <div className="flex justify-center gap-4 mb-6">
              <Input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="w-44 bg-secondary/50 border-border/50 h-11"
              />
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 h-12 px-8 text-base"
              onClick={handleStart}
              disabled={starting}
            >
              <Play className="w-4 h-4 mr-2" /> {starting ? "開始中..." : "棚卸し開始"}
            </Button>
          </motion.div>

          {/* 履歴 */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
            <h3 className="text-base font-semibold mb-4">過去の棚卸し</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left py-2 px-4 font-medium">日付</th>
                    <th className="text-right py-2 px-4 font-medium">差異商品数</th>
                    <th className="text-right py-2 px-4 font-medium">品目数</th>
                    <th className="text-center py-2 px-4 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-4 font-num">{new Date(h.stocktakeDate).toLocaleDateString("ja-JP")}</td>
                      <td className="py-2 px-4 text-right font-num">{h.discrepancyCount}件</td>
                      <td className="py-2 px-4 text-right font-num">{h.totalProducts}品目</td>
                      <td className="py-2 px-4 text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            h.status === "IN_PROGRESS" && "bg-edo-warning/15 text-edo-warning border-edo-warning/30",
                            h.status === "COMPLETED" && "bg-edo-success/15 text-edo-success border-edo-success/30"
                          )}
                        >
                          {h.status === "COMPLETED" ? "完了" : "進行中"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted-foreground">
                        <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p>まだ棚卸しの記録がありません</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </>
      ) : (
        <>
          {/* 進捗バー */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">進捗</span>
              <span className="text-sm font-num font-semibold">{completed}/{total} 品目</span>
            </div>
            <Progress value={progress} className="h-2" />
          </motion.div>

          {/* 部門タブ */}
          {categories.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Tabs defaultValue={categories[0]}>
                <TabsList className="bg-secondary/50 mb-4 flex-wrap h-auto gap-1">
                  {categories.map((c) => (
                    <TabsTrigger key={c} value={c} className="text-xs">
                      {c}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({categoriesMap.get(c)?.filter((i) => i.actualStock !== null).length}/{categoriesMap.get(c)?.length})
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {categories.map((cat) => (
                  <TabsContent key={cat} value={cat}>
                    <div className="space-y-3">
                      {categoriesMap.get(cat)?.map((item) => (
                        <div
                          key={item.productId}
                          className={cn(
                            "glass-card p-4 flex items-center gap-4 transition-colors",
                            item.discrepancy !== null && item.discrepancy !== 0 && "border-edo-warning/30 bg-edo-warning/5"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{item.product.name}</p>
                            <p className="text-xs text-muted-foreground">理論在庫: <span className="font-num font-semibold">{item.theoreticalStock}</span></p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Input
                              type="number"
                              placeholder="実在庫"
                              defaultValue={item.actualStock ?? ""}
                              onBlur={(e) => handleCountUpdate(item.productId, e.target.value)}
                              className="w-20 h-10 bg-secondary/50 border-border/50 font-num text-center"
                            />
                            {item.discrepancy !== null && item.discrepancy !== 0 && (
                              <>
                                <Badge className="bg-edo-warning/15 text-edo-warning border-edo-warning/30 text-xs font-num">
                                  {item.discrepancy > 0 ? "+" : ""}{item.discrepancy}
                                </Badge>
                                <Select
                                  defaultValue={item.reason || "NONE"}
                                  onValueChange={(v) => handleCountUpdate(item.productId, String(item.actualStock ?? ""), v)}
                                >
                                  <SelectTrigger className="w-28 h-10 bg-secondary/50 border-border/50 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {reasons.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </>
                            )}
                            {item.discrepancy === 0 && (
                              <CheckCircle className="w-5 h-5 text-edo-success" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </motion.div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>商品が登録されていません</p>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => { setStocktakeId(null); setDetail(null); }}>中止</Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleComplete}
              disabled={completing || completed < total}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {completing ? "確定中..." : completed < total ? `残り${total - completed}品目` : "棚卸し確定"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default Stocktake;
