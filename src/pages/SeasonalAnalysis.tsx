import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

const monthlyData = [
  { month: "4月", sales: 4259114, prevYear: 3980000 },
  { month: "5月", sales: 4523000, prevYear: 4200000 },
  { month: "6月", sales: 3980000, prevYear: 3850000 },
  { month: "7月", sales: 3456000, prevYear: 3300000 },
  { month: "8月", sales: 3210000, prevYear: 3100000 },
  { month: "9月", sales: 3780000, prevYear: 3600000 },
  { month: "10月", sales: 4120000, prevYear: 3950000 },
  { month: "11月", sales: 4890000, prevYear: 4700000 },
  { month: "12月", sales: 11630736, prevYear: 10800000 },
  { month: "1月", sales: 3520000, prevYear: 3400000 },
  { month: "2月", sales: 3180000, prevYear: 3050000 },
  { month: "3月", sales: 4350000, prevYear: 4100000 },
];

const heatmapData = [
  { month: "4月", value: 4.2 }, { month: "5月", value: 4.5 }, { month: "6月", value: 4.0 },
  { month: "7月", value: 3.5 }, { month: "8月", value: 3.2 }, { month: "9月", value: 3.8 },
  { month: "10月", value: 4.1 }, { month: "11月", value: 4.9 }, { month: "12月", value: 11.6 },
  { month: "1月", value: 3.5 }, { month: "2月", value: 3.2 }, { month: "3月", value: 4.4 },
];

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
  return (
    <div className="space-y-6">
      {/* 月別売上トレンド */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">月別売上トレンド（前年比較）</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
              <YAxis tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} tickFormatter={(v: number) => `${(v/10000).toFixed(0)}万`} />
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
          {heatmapData.map((d) => (
            <div
              key={d.month}
              className={cn("rounded-lg p-3 text-center transition-colors", getHeatColor(d.value))}
            >
              <p className="text-[10px] mb-1">{d.month}</p>
              <p className="text-sm font-num font-semibold">{d.value.toFixed(1)}M</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">📌 12月は通常月の約3倍の売上。11月から仕入れを強化する必要があります。</p>
      </motion.div>

      {/* インサイト */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="glass-card p-4 border-accent/20">
        <p className="text-sm">💡 <span className="font-semibold">季節パターン:</span> 夏季（7-9月）は閑散期で月商約300万円台。12月の繁忙期に向けて10月から在庫積み増しを推奨します。</p>
      </motion.div>
    </div>
  );
};

export default SeasonalAnalysis;
