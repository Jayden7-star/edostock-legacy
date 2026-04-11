import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  variant?: "default" | "alert" | "success" | "gold";
  delay?: number;
}

const variantStyles = {
  default: "border-border/50",
  alert: "border-primary/30",
  success: "border-edo-success/30",
  gold: "border-accent/30",
};

const iconBgStyles = {
  default: "bg-secondary text-foreground",
  alert: "bg-primary/15 text-primary",
  success: "bg-edo-success/15 text-edo-success",
  gold: "bg-accent/15 text-accent",
};

const KpiCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = "default",
  delay = 0,
}: KpiCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      className={cn("glass-card-hover p-5 lg:p-6 border-t-[3px] border-t-primary", variantStyles[variant])}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", iconBgStyles[variant])}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium font-num px-2 py-1 rounded-full",
              trend.positive
                ? "bg-edo-success/15 text-edo-success"
                : "bg-primary/15 text-primary"
            )}
          >
            {trend.positive ? "↑" : "↓"} {trend.value}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-1">{title}</p>
      <p className="text-2xl lg:text-3xl font-bold font-num tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </motion.div>
  );
};

export default KpiCard;
