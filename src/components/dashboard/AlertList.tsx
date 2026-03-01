import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertItem {
  name: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
  severity: "critical" | "warning" | "low";
}

const mockAlerts: AlertItem[] = [
  { name: "江戸一昆布", category: "佃煮（自社）", currentStock: 0, reorderPoint: 10, severity: "critical" },
  { name: "一口ほたて(大)", category: "佃煮（自社）", currentStock: 2, reorderPoint: 8, severity: "critical" },
  { name: "しそ巻き", category: "佃煮（仕入）", currentStock: 3, reorderPoint: 5, severity: "warning" },
  { name: "ちりめん山椒", category: "佃煮（リパック）", currentStock: 5, reorderPoint: 7, severity: "warning" },
  { name: "黒豆", category: "煮豆", currentStock: 4, reorderPoint: 5, severity: "low" },
];

const severityStyles = {
  critical: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-edo-warning/15 text-edo-warning border-edo-warning/30",
  low: "bg-edo-info/15 text-edo-info border-edo-info/30",
};

const severityDot = {
  critical: "bg-primary",
  warning: "bg-edo-warning",
  low: "bg-edo-info",
};

const AlertList = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="glass-card p-5 lg:p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" />
          <h3 className="text-base font-semibold">発注アラート TOP5</h3>
        </div>
        <button className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
          すべて表示 <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-3">
        {mockAlerts.map((item, i) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.08, duration: 0.3 }}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-secondary/30",
              severityStyles[item.severity]
            )}
          >
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", severityDot[item.severity])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.category}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-num font-semibold">
                {item.currentStock} <span className="text-muted-foreground font-normal">/ {item.reorderPoint}</span>
              </p>
              <p className="text-[10px] text-muted-foreground">現在庫 / 発注点</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default AlertList;
