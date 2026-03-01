import { useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Play, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface StocktakeItem {
  id: number;
  name: string;
  category: string;
  theoreticalStock: number;
  actualStock: number | null;
  discrepancy: number | null;
}

const mockItems: Record<string, StocktakeItem[]> = {
  "佃煮（自社）": [
    { id: 1, name: "江戸一昆布", category: "佃煮（自社）", theoreticalStock: 25, actualStock: 23, discrepancy: -2 },
    { id: 2, name: "一口ほたて(大)", category: "佃煮（自社）", theoreticalStock: 18, actualStock: 18, discrepancy: 0 },
    { id: 3, name: "しそ昆布", category: "佃煮（自社）", theoreticalStock: 12, actualStock: null, discrepancy: null },
    { id: 4, name: "ごま昆布", category: "佃煮（自社）", theoreticalStock: 8, actualStock: null, discrepancy: null },
  ],
  "佃煮（仕入）": [
    { id: 5, name: "しそ巻き", category: "佃煮（仕入）", theoreticalStock: 10, actualStock: 9, discrepancy: -1 },
    { id: 6, name: "桜田夫", category: "佃煮（仕入）", theoreticalStock: 7, actualStock: null, discrepancy: null },
  ],
  "煮豆": [
    { id: 7, name: "黒豆", category: "煮豆", theoreticalStock: 6, actualStock: 6, discrepancy: 0 },
    { id: 8, name: "うずら豆", category: "煮豆", theoreticalStock: 4, actualStock: null, discrepancy: null },
  ],
};

const reasons = ["なし", "数え間違い", "破損", "盗難", "不明"];

const mockHistory = [
  { id: 1, date: "2026/02/01", discrepancies: 8, amount: "¥12,500", status: "完了" },
  { id: 2, date: "2026/01/05", discrepancies: 3, amount: "¥4,200", status: "完了" },
];

const Stocktake = () => {
  const [started, setStarted] = useState(false);
  const categories = Object.keys(mockItems);
  const allItems = Object.values(mockItems).flat();
  const completed = allItems.filter((i) => i.actualStock !== null).length;
  const total = allItems.length;
  const progress = (completed / total) * 100;

  return (
    <div className="space-y-6">
      {!started ? (
        <>
          {/* 開始画面 */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
              <ClipboardList className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">棚卸しを開始</h2>
            <p className="text-muted-foreground mb-6">全商品の実在庫数を入力し、理論在庫との差異を確認します</p>
            <div className="flex justify-center gap-4 mb-6">
              <Input type="date" defaultValue="2026-03-01" className="w-44 bg-secondary/50 border-border/50 h-11" />
            </div>
            <Button className="bg-primary hover:bg-primary/90 h-12 px-8 text-base" onClick={() => setStarted(true)}>
              <Play className="w-4 h-4 mr-2" /> 棚卸し開始
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
                    <th className="text-right py-2 px-4 font-medium">差異金額</th>
                    <th className="text-center py-2 px-4 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {mockHistory.map((h) => (
                    <tr key={h.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-4 font-num">{h.date}</td>
                      <td className="py-2 px-4 text-right font-num">{h.discrepancies}件</td>
                      <td className="py-2 px-4 text-right font-num text-primary">{h.amount}</td>
                      <td className="py-2 px-4 text-center"><Badge variant="outline" className="text-xs">{h.status}</Badge></td>
                    </tr>
                  ))}
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
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Tabs defaultValue={categories[0]}>
              <TabsList className="bg-secondary/50 mb-4">
                {categories.map((c) => (
                  <TabsTrigger key={c} value={c} className="text-xs">{c}</TabsTrigger>
                ))}
              </TabsList>
              {categories.map((cat) => (
                <TabsContent key={cat} value={cat}>
                  <div className="space-y-3">
                    {mockItems[cat].map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "glass-card p-4 flex items-center gap-4 transition-colors",
                          item.discrepancy !== null && item.discrepancy !== 0 && "border-edo-warning/30 bg-edo-warning/5"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">理論在庫: <span className="font-num font-semibold">{item.theoreticalStock}</span></p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Input
                            type="number"
                            placeholder="実在庫"
                            defaultValue={item.actualStock ?? ""}
                            className="w-20 h-10 bg-secondary/50 border-border/50 font-num text-center"
                          />
                          {item.discrepancy !== null && item.discrepancy !== 0 && (
                            <>
                              <Badge className="bg-edo-warning/15 text-edo-warning border-edo-warning/30 text-xs font-num">
                                {item.discrepancy > 0 ? "+" : ""}{item.discrepancy}
                              </Badge>
                              <Select defaultValue="なし">
                                <SelectTrigger className="w-28 h-10 bg-secondary/50 border-border/50 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStarted(false)}>中止</Button>
            <Button className="bg-primary hover:bg-primary/90">
              <CheckCircle className="w-4 h-4 mr-2" /> 棚卸し確定
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default Stocktake;
