import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Copy, Check, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

interface AlertItem {
  id: number;
  name: string;
  category: string;
  department: string;
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  severity: "critical" | "warning";
}

const sevConfig = {
  critical: { label: "在庫切れ", color: "bg-primary/15 text-primary border-primary/30", bar: "bg-primary" },
  warning: { label: "発注点以下", color: "bg-edo-warning/15 text-edo-warning border-edo-warning/30", bar: "bg-edo-warning" },
};

const Alerts = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    const url = department ? `/api/inventory/alerts?department=${department}` : "/api/inventory/alerts";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then(setAlerts)
      .catch(() => toast({ title: "エラー", description: "アラートの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [department, toast]);

  const handleCopy = () => {
    const text = alerts
      .map((a) => `${a.name}: ${a.optimalStock - a.currentStock}個`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "コピーしました", description: "発注リストをクリップボードにコピーしました" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-32 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-primary" />
          <span className="text-sm text-muted-foreground">
            <span className="font-num font-semibold text-foreground">{alerts.length}</span> 件の発注が必要です
          </span>
        </div>
        {alerts.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            発注リストをコピー
          </Button>
        )}
      </motion.div>

      {alerts.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>発注が必要な商品はありません 🎉</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {alerts.map((item, i) => {
            const cfg = sevConfig[item.severity];
            const recommended = item.optimalStock - item.currentStock;
            const pct = item.optimalStock > 0 ? (item.currentStock / item.optimalStock) * 100 : 0;
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
                    <span className="text-muted-foreground">在庫状況{item.department === "APPAREL" ? ` (${new Date().getMonth() + 1}月)` : ""}</span>
                    <span className="font-num"><span className="font-semibold">{item.currentStock}</span> / {item.optimalStock}</span>
                  </div>
                  <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", cfg.bar)} style={{ width: `${pct}%` }} />
                    {item.optimalStock > 0 && (
                      <div className="absolute h-full w-0.5 bg-foreground/30 top-0" style={{ left: `${(item.reorderPoint / item.optimalStock) * 100}%` }} />
                    )}
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
      )}
    </div>
  );
};

export default Alerts;
