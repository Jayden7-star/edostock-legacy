import { useState, useEffect } from "react";
import { Bell, Package, TrendingUp, Percent, AlertTriangle, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import KpiCard from "@/components/dashboard/KpiCard";
import SalesChart from "@/components/dashboard/SalesChart";
import AlertList from "@/components/dashboard/AlertList";
import RecommendationBanner from "@/components/dashboard/RecommendationBanner";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

interface DashboardData {
  alertCount: number;
  totalStock: number;
  totalProducts: number;
  monthlySales: number;
  salesChange: number;
  grossMarginRate: number;
  salesTrend: { month: string; sales: number }[];
  forecastNextMonth: number;
  seasonalNote: string | null;
  alertProducts: { id: number; name: string; currentStock: number; reorderPoint: number; category: string }[];
  lastSyncAt: string | null;
  syncEnabled: boolean;
}

const Index = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    const url = department ? `/api/analytics/dashboard?department=${department}` : "/api/analytics/dashboard";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast({ title: "エラー", description: "ダッシュボードデータの取得に失敗しました", variant: "destructive" }));
  }, [department, toast]);

  const d = data || {
    alertCount: 0, totalStock: 0, totalProducts: 0,
    monthlySales: 0, salesChange: 0, grossMarginRate: 0,
    salesTrend: [], forecastNextMonth: 0, seasonalNote: null, alertProducts: [],
    lastSyncAt: null, syncEnabled: false,
  };

  return (
    <div className="space-y-6">
      {/* スマレジ同期ステータス */}
      {d.syncEnabled && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3" />
          <span>スマレジ最終同期: <span className="font-num">{d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString("ja-JP") : "未同期"}</span></span>
          <Badge variant="outline" className="bg-edo-success/15 text-edo-success border-edo-success/30 text-[10px] py-0">自動同期ON</Badge>
        </motion.div>
      )}

      {/* KPIカード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
        <KpiCard
          title="発注アラート"
          value={String(d.alertCount)}
          subtitle="発注点以下の商品"
          icon={Bell}
          variant="alert"
          delay={0}
        />
        <KpiCard
          title="在庫総数"
          value={d.totalStock.toLocaleString()}
          subtitle={`${d.totalProducts}品目`}
          icon={Package}
          variant="default"
          delay={0.08}
        />
        <KpiCard
          title="今月売上"
          value={d.monthlySales > 0 ? `¥${d.monthlySales.toLocaleString()}` : "—"}
          icon={TrendingUp}
          trend={d.salesChange !== 0 ? { value: `${Math.abs(d.salesChange)}%`, positive: d.salesChange > 0 } : undefined}
          variant="success"
          delay={0.16}
        />
        <KpiCard
          title="粗利率"
          value={d.grossMarginRate > 0 ? `${d.grossMarginRate}%` : "—"}
          icon={Percent}
          variant="gold"
          delay={0.24}
        />
      </div>

      {/* チャート + アラート */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-5">
        <div className="xl:col-span-2">
          <SalesChart data={d.salesTrend} />
        </div>
        <AlertList alerts={d.alertProducts} />
      </div>

      {/* 季節予測バナー */}
      {d.seasonalNote && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="glass-card p-5 lg:p-6 border-edo-warning/20"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-edo-warning/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-edo-warning" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-0.5">売上予測・季節アラート</h3>
              <p className="text-xs text-muted-foreground">{d.seasonalNote}</p>
              {d.forecastNextMonth > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  翌月予測売上: <span className="font-num font-semibold text-edo-warning">¥{d.forecastNextMonth.toLocaleString()}</span>
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* 提案バナー */}
      <RecommendationBanner />
    </div>
  );
};

export default Index;
