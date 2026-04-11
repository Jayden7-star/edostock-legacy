import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface AlertItem {
  name: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
}

const defaultAlerts: AlertItem[] = [
  { name: "江戸一昆布", category: "佃煮（自社）", currentStock: 0, reorderPoint: 10 },
  { name: "一口ほたて(大)", category: "佃煮（自社）", currentStock: 2, reorderPoint: 8 },
  { name: "しそ巻き", category: "佃煮（仕入）", currentStock: 3, reorderPoint: 5 },
  { name: "ちりめん山椒", category: "佃煮（リパック）", currentStock: 5, reorderPoint: 7 },
  { name: "黒豆", category: "煮豆", currentStock: 4, reorderPoint: 5 },
];

function getSeverity(item: AlertItem): "critical" | "warning" | "low" {
  if (item.currentStock <= 0) return "critical";
  if (item.currentStock <= item.reorderPoint * 0.5) return "critical";
  if (item.currentStock <= item.reorderPoint) return "warning";
  return "low";
}

const severityStyles = {
  critical: "bg-primary/15 text-primary border-primary/30 border-l-[3px] border-l-destructive",
  warning: "bg-edo-warning/15 text-edo-warning border-edo-warning/30 border-l-[3px] border-l-edo-warning",
  low: "bg-edo-info/15 text-edo-info border-edo-info/30",
};

const severityDot = {
  critical: "bg-primary",
  warning: "bg-edo-warning",
  low: "bg-edo-info",
};

interface AlertListProps {
  alerts?: AlertItem[];
}

const AlertList = ({ alerts }: AlertListProps) => {
  const navigate = useNavigate();
  const items = alerts && alerts.length > 0 ? alerts : defaultAlerts;

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
        <button
          onClick={() => navigate("/alerts")}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          すべて表示 <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-3">
        {items.slice(0, 5).map((item, i) => {
          const severity = getSeverity(item);
          return (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.3 }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-secondary/30",
                severityStyles[severity]
              )}
            >
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0", severityDot[severity])} />
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
          );
        })}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            アラート対象の商品はありません 🎉
          </p>
        )}
      </div>
    </motion.div>
  );
};

export default AlertList;
