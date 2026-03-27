import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileDown, Package } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useSearchParams } from "react-router-dom";

interface ForecastItem {
  id: number;
  name: string;
  category: string;
  currentStock: number;
  recentWeekly: number;
  weekForecast: number;
  monthForecast: number;
  recommended: number;
  sparkline: number[];
}

interface ForecastData {
  forecasts: ForecastItem[];
  seasonalIndex: Record<string, number>;
  dataStatus: string;
  note: string | null;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="glass-card px-3 py-2 text-xs">
        <p className="font-medium mb-1">{label}</p>
        {payload.filter((p: any) => p.value != null).map((p: any) => (
          <p key={p.name} className="font-num" style={{ color: p.stroke }}>
            {p.name === "actual" ? "実績" : "予測"}: {p.value}個
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const Forecast = () => {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("all");
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    const url = department ? `/api/analytics/forecast?department=${department}` : "/api/analytics/forecast";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast({ title: "エラー", description: "需要予測データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [department, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-20 shimmer" />
        ))}
      </div>
    );
  }

  if (!data || data.dataStatus === "insufficient") {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-12 text-center">
          <FileDown className="w-12 h-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground">{data?.note || "予測に必要なデータが不足しています"}</p>
          <p className="text-sm text-muted-foreground mt-1">CSVを3ヶ月分以上インポートしてください</p>
        </motion.div>
      </div>
    );
  }

  const { forecasts } = data;

  // Build trend chart data for selected product
  const selectedProduct = selected !== "all" ? forecasts.find((f) => f.name === selected) : forecasts[0];
  const trendData = selectedProduct
    ? [
      ...selectedProduct.sparkline.map((v, i) => ({
        week: `W${i + 1}`,
        actual: v,
        forecast: null as number | null,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        week: `W${selectedProduct.sparkline.length + i + 1}`,
        actual: null as number | null,
        forecast: selectedProduct.weekForecast + Math.round((Math.random() - 0.5) * 4),
      })),
    ]
    : [];

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-44 bg-secondary/50 border-border/50 h-10">
            <SelectValue placeholder="商品を選択" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全商品</SelectItem>
            {forecasts.map((d) => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </motion.div>

      {/* 注意バナー */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="glass-card p-4 border-edo-warning/20 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-edo-warning flex-shrink-0" />
        <p className="text-sm text-muted-foreground">
          予測精度はデータ蓄積に伴い向上します。季節指数（{data.seasonalIndex ? `${new Date().getMonth() + 1}月: ×${(data.seasonalIndex[String(new Date().getMonth() + 1)] || 1).toFixed(2)}` : "計算中"}）が適用されています。
        </p>
      </motion.div>

      {/* トレンドグラフ */}
      {selectedProduct && trendData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
          <h3 className="text-base font-semibold mb-4">{selectedProduct.name} — 販売実績 + 予測</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(28, 45%, 64%)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(28, 45%, 64%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 20%)" />
                <XAxis dataKey="week" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 12 }} />
                <YAxis tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="actual" stroke="hsl(348, 78%, 58%)" strokeWidth={2.5} fill="url(#actualGrad)" dot={{ r: 3 }} connectNulls={false} />
                <Area type="monotone" dataKey="forecast" stroke="hsl(28, 45%, 64%)" strokeWidth={2} strokeDasharray="6 3" fill="url(#forecastGrad)" dot={{ r: 3 }} connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><div className="w-6 h-0.5 bg-primary rounded" /> 実績</div>
            <div className="flex items-center gap-2"><div className="w-6 h-0.5 bg-accent rounded" style={{ borderTop: "1.5px dashed" }} /> 予測</div>
          </div>
        </motion.div>
      )}

      {/* 予測テーブル */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left py-3 px-4 font-medium">商品名</th>
                <th className="text-right py-3 px-4 font-medium">直近実績</th>
                <th className="text-right py-3 px-4 font-medium">翌週予測</th>
                <th className="text-right py-3 px-4 font-medium">翌月予測</th>
                <th className="text-right py-3 px-4 font-medium">推奨入庫数</th>
              </tr>
            </thead>
            <tbody>
              {forecasts
                .filter((d) => selected === "all" || d.name === selected)
                .map((d, i) => (
                  <motion.tr key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.04 }}
                    className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 px-4 font-medium">{d.name}</td>
                    <td className="py-3 px-4 text-right font-num">{d.recentWeekly}</td>
                    <td className="py-3 px-4 text-right font-num">{d.weekForecast}</td>
                    <td className="py-3 px-4 text-right font-num">{d.monthForecast}</td>
                    <td className="py-3 px-4 text-right font-num font-semibold text-accent">{d.recommended}</td>
                  </motion.tr>
                ))}
              {forecasts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>予測データがありません</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default Forecast;
