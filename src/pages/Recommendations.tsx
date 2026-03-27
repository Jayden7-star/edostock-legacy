import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

interface Recommendation {
  id: number;
  name: string;
  category: string;
  severity: "critical" | "warning" | "observe";
  turnoverDays: number;
  stockValue: number;
  recentSales: number;
  suggestion: string;
  sparkline: number[];
}

const sevConfig = {
  critical: { label: "即対応", color: "bg-primary text-primary-foreground", border: "border-primary/30" },
  warning: { label: "要検討", color: "bg-edo-warning text-background", border: "border-edo-warning/30" },
  observe: { label: "経過観察", color: "bg-edo-info text-background", border: "border-edo-info/30" },
};

const sparkColors: Record<string, string> = {
  critical: "hsl(348, 78%, 58%)",
  warning: "hsl(38, 92%, 60%)",
  observe: "hsl(210, 70%, 55%)",
};

const MiniSparkline = ({ data, color }: { data: number[]; color: string }) => {
  const max = Math.max(...data, 1);
  const h = 30;
  const w = 80;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const Recommendations = () => {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    const url = department ? `/api/analytics/recommendations?department=${department}` : "/api/analytics/recommendations";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setRecs(data.recommendations || []))
      .catch(() => toast({ title: "エラー", description: "商品切替提案の取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [department, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-48 shimmer" />
        ))}
      </div>
    );
  }

  if (recs.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-12 text-center">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
        <p className="text-muted-foreground">切替が必要な商品はありません 🎉</p>
        <p className="text-sm text-muted-foreground mt-1">売上データが増えると自動で提案が生成されます</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Tabs defaultValue="all">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="all">すべて ({recs.length})</TabsTrigger>
            <TabsTrigger value="critical">🔴 即対応 ({recs.filter(r => r.severity === "critical").length})</TabsTrigger>
            <TabsTrigger value="warning">🟡 要検討 ({recs.filter(r => r.severity === "warning").length})</TabsTrigger>
            <TabsTrigger value="observe">🔵 経過観察 ({recs.filter(r => r.severity === "observe").length})</TabsTrigger>
          </TabsList>

          {["all", "critical", "warning", "observe"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                {recs
                  .filter((r) => tab === "all" || r.severity === tab)
                  .map((r, i) => {
                    const cfg = sevConfig[r.severity];
                    const sparkColor = sparkColors[r.severity] || sparkColors.observe;
                    return (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                        className={cn("glass-card-hover p-5", cfg.border)}
                      >
                        {/* ヘッダー */}
                        <div className="flex items-start justify-between mb-3">
                          <Badge className={cn("text-xs px-2 py-0.5", cfg.color)}>{cfg.label}</Badge>
                        </div>

                        <h3 className="font-semibold mb-1">{r.name}</h3>
                        <Badge variant="outline" className="text-xs border-border/50 mb-4">{r.category}</Badge>

                        {/* スパークライン */}
                        <div className="mb-4 flex items-center gap-2">
                          <MiniSparkline data={r.sparkline} color={sparkColor} />
                          <TrendingDown className="w-4 h-4 text-primary" />
                        </div>

                        {/* 指標 */}
                        <div className="space-y-1.5 text-sm mb-4">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">在庫回転</span>
                            <span className="font-num font-medium">{r.turnoverDays}日</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">在庫金額</span>
                            <span className="font-num font-medium">¥{r.stockValue.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">直近3ヶ月売上</span>
                            <span className={cn("font-num font-medium", r.recentSales === 0 && "text-primary")}>
                              ¥{r.recentSales.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground mb-3">
                          推奨: <span className="text-foreground font-medium">{r.suggestion}</span>
                        </p>

                        <div className="flex gap-2">
                          {r.severity === "critical" && (
                            <>
                              <Button size="sm" variant="outline" className="text-xs h-8 flex-1">値引き</Button>
                              <Button size="sm" variant="outline" className="text-xs h-8 flex-1 text-primary border-primary/30 hover:bg-primary/10">発注停止</Button>
                            </>
                          )}
                          {r.severity === "warning" && (
                            <Button size="sm" variant="outline" className="text-xs h-8 flex-1">入荷量調整</Button>
                          )}
                          <Button size="sm" variant="outline" className="text-xs h-8 flex-1">経過観察</Button>
                        </div>
                      </motion.div>
                    );
                  })}
                {recs.filter((r) => tab === "all" || r.severity === tab).length === 0 && (
                  <div className="col-span-full py-8 text-center text-muted-foreground">
                    <p>このカテゴリの提案はありません</p>
                  </div>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </motion.div>
    </div>
  );
};

export default Recommendations;
