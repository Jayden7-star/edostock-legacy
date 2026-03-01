import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

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

const mockRecs: Recommendation[] = [
  { id: 1, name: "桜田夫", category: "佃煮（仕入）", severity: "critical", turnoverDays: 180, stockValue: 15200, recentSales: 0, suggestion: "発注停止・値引き販売", sparkline: [5, 3, 2, 1, 0, 0] },
  { id: 2, name: "うずら豆", category: "煮豆", severity: "critical", turnoverDays: 150, stockValue: 8400, recentSales: 0, suggestion: "発注停止・値引き販売", sparkline: [3, 2, 1, 1, 0, 0] },
  { id: 3, name: "粉わさび", category: "その他（仕入）", severity: "critical", turnoverDays: 200, stockValue: 5600, recentSales: 0, suggestion: "撤去検討", sparkline: [2, 1, 0, 0, 0, 0] },
  { id: 4, name: "ばかうけ", category: "菓子", severity: "warning", turnoverDays: 95, stockValue: 3840, recentSales: 1200, suggestion: "入荷量削減", sparkline: [8, 6, 5, 3, 3, 2] },
  { id: 5, name: "甘酒の素", category: "その他（仕入）", severity: "warning", turnoverDays: 92, stockValue: 6200, recentSales: 2100, suggestion: "季節商品として管理", sparkline: [10, 8, 4, 2, 3, 4] },
  { id: 6, name: "ソックス各種", category: "雑貨", severity: "observe", turnoverDays: 60, stockValue: 12000, recentSales: 8500, suggestion: "経過観察", sparkline: [15, 14, 12, 10, 9, 8] },
];

const sevConfig = {
  critical: { label: "即対応", color: "bg-primary text-primary-foreground", border: "border-primary/30" },
  warning: { label: "要検討", color: "bg-edo-warning text-background", border: "border-edo-warning/30" },
  observe: { label: "経過観察", color: "bg-edo-info text-background", border: "border-edo-info/30" },
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
  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Tabs defaultValue="all">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="all">すべて ({mockRecs.length})</TabsTrigger>
            <TabsTrigger value="critical">🔴 即対応 ({mockRecs.filter(r => r.severity === "critical").length})</TabsTrigger>
            <TabsTrigger value="warning">🟡 要検討 ({mockRecs.filter(r => r.severity === "warning").length})</TabsTrigger>
            <TabsTrigger value="observe">🔵 経過観察 ({mockRecs.filter(r => r.severity === "observe").length})</TabsTrigger>
          </TabsList>

          {["all", "critical", "warning", "observe"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                {mockRecs
                  .filter((r) => tab === "all" || r.severity === tab)
                  .map((r, i) => {
                    const cfg = sevConfig[r.severity];
                    const sparkColor = r.severity === "critical" ? "hsl(348, 78%, 58%)" : r.severity === "warning" ? "hsl(38, 92%, 60%)" : "hsl(210, 70%, 55%)";
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
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </motion.div>
    </div>
  );
};

export default Recommendations;
