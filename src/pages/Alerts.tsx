import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface AlertItem {
  id: number;
  name: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  severity: "critical" | "warning" | "low";
}

const mockAlerts: AlertItem[] = [
  { id: 1, name: "江戸一昆布", category: "佃煮（自社）", currentStock: 0, reorderPoint: 10, optimalStock: 30, severity: "critical" },
  { id: 2, name: "一口ほたて(大)", category: "佃煮（自社）", currentStock: 2, reorderPoint: 8, optimalStock: 20, severity: "critical" },
  { id: 3, name: "しそ巻き", category: "佃煮（仕入）", currentStock: 3, reorderPoint: 5, optimalStock: 15, severity: "warning" },
  { id: 4, name: "ちりめん山椒", category: "佃煮（リパック）", currentStock: 5, reorderPoint: 7, optimalStock: 20, severity: "warning" },
  { id: 5, name: "黒豆", category: "煮豆", currentStock: 4, reorderPoint: 5, optimalStock: 12, severity: "low" },
  { id: 6, name: "五目まぜご飯の素", category: "混ぜご飯の素", currentStock: 3, reorderPoint: 5, optimalStock: 20, severity: "warning" },
];

const sevConfig = {
  critical: { label: "在庫切れ", color: "bg-primary/15 text-primary border-primary/30", bar: "bg-primary" },
  warning: { label: "発注点以下", color: "bg-edo-warning/15 text-edo-warning border-edo-warning/30", bar: "bg-edo-warning" },
  low: { label: "残り僅か", color: "bg-edo-info/15 text-edo-info border-edo-info/30", bar: "bg-edo-info" },
};

const Alerts = () => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = () => {
    const text = mockAlerts
      .map((a) => `${a.name}: ${a.optimalStock - a.currentStock}個`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "コピーしました", description: "発注リストをクリップボードにコピーしました" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-primary" />
          <span className="text-sm text-muted-foreground">
            <span className="font-num font-semibold text-foreground">{mockAlerts.length}</span> 件の発注が必要です
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          発注リストをコピー
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mockAlerts.map((item, i) => {
          const cfg = sevConfig[item.severity];
          const recommended = item.optimalStock - item.currentStock;
          const pct = (item.currentStock / item.optimalStock) * 100;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass-card-hover p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold mb-1">{item.name}</h3>
                  <Badge variant="outline" className="text-xs border-border/50">{item.category}</Badge>
                </div>
                <Badge className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>
              </div>
              <div className="space-y-3 mt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">在庫状況</span>
                  <span className="font-num"><span className="font-semibold">{item.currentStock}</span> / {item.optimalStock}</span>
                </div>
                <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", cfg.bar)} style={{ width: `${pct}%` }} />
                  <div className="absolute h-full w-0.5 bg-foreground/30 top-0" style={{ left: `${(item.reorderPoint / item.optimalStock) * 100}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>発注点: {item.reorderPoint}</span>
                  <span className="font-semibold text-accent">推奨発注: {recommended}個</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Alerts;
