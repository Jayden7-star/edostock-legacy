import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

interface MonthlyTrendItem {
  month: string;
  sales: number;
  prevYear: number | null;
}

interface HeatmapItem {
  month: string;
  value: number;
}

interface SeasonalData {
  monthlyTrend: MonthlyTrendItem[];
  heatmap: HeatmapItem[];
  insight: string | null;
  dataStatus: string;
}

const getHeatColor = (v: number) => {
  if (v > 8) return "bg-primary text-primary-foreground";
  if (v > 5) return "bg-primary/60 text-primary-foreground";
  if (v > 4) return "bg-accent/40 text-accent-foreground";
  return "bg-secondary text-muted-foreground";
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="glass-card px-3 py-2 text-xs">
        <p className="font-medium mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="font-num" style={{ color: p.stroke }}>
            {p.name === "sales" ? "今年" : "前年"}: ¥{p.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const SeasonalAnalysis = () => {
  const [data, setData] = useState<SeasonalData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    const url = department ? `/api/analytics/seasonal?department=${department}` : "/api/analytics/seasonal";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast({ title: "エラー", description: "季節性分析データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [department, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-32 shimmer" />
        ))}
      </div>
    );
  }

  if (!data || data.dataStatus === "insufficient") {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-12 text-center">
        <FileDown className="w-12 h-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
        <p className="text-muted-foreground">月次売上データがありません</p>
        <p className="text-sm text-muted-foreground mt-1">CSVデータをインポートしてください</p>
      </motion.div>
    );
  }

  const { monthlyTrend, heatmap, insight } = data;

  return (
    <div className="space-y-6">
      {/* 月別売上トレンド */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">月別売上トレンド（前年比較）</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="prevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(220, 10%, 55%)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="hsl(220, 10%, 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 20%)" />
              <XAxis dataKey="month" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="prevYear" stroke="hsl(220, 10%, 55%)" strokeWidth={1.5} strokeDasharray="4 4" fill="url(#prevGrad)" dot={false} />
              <Area type="monotone" dataKey="sales" stroke="hsl(348, 78%, 58%)" strokeWidth={2.5} fill="url(#salesGrad)" dot={false}
                activeDot={{ r: 5, fill: "hsl(348, 78%, 58%)", stroke: "hsl(228, 25%, 12%)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><div className="w-6 h-0.5 bg-primary rounded" /> 今年</div>
          <div className="flex items-center gap-2"><div className="w-6 h-0.5 bg-muted-foreground rounded border-dashed" style={{ borderTop: "1.5px dashed" }} /> 前年</div>
        </div>
      </motion.div>

      {/* ヒートマップ */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">月別売上ヒートマップ</h3>
        <div className="grid grid-cols-6 lg:grid-cols-12 gap-2">
          {heatmap.map((d) => (
            <div
              key={d.month}
              className={cn("rounded-lg p-3 text-center transition-colors", getHeatColor(d.value))}
            >
              <p className="text-[10px] mb-1">{d.month}</p>
              <p className="text-sm font-num font-semibold">{d.value.toFixed(1)}M</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* インサイト */}
      {insight && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="glass-card p-4 border-accent/20">
          <p className="text-sm">💡 <span className="font-semibold">季節パターン:</span> {insight}</p>
        </motion.div>
      )}
    </div>
  );
};

export default SeasonalAnalysis;
