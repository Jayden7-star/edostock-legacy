import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const forecastData = [
  { name: "江戸一昆布", recent: 75, weekForecast: 72, monthForecast: 310, recommended: 285 },
  { name: "タオル桜富士", recent: 82, weekForecast: 78, monthForecast: 340, recommended: 258 },
  { name: "特売1200", recent: 39, weekForecast: 35, monthForecast: 155, recommended: 130 },
  { name: "一口ほたて(大)", recent: 26, weekForecast: 24, monthForecast: 105, recommended: 85 },
  { name: "しそ巻き", recent: 18, weekForecast: 16, monthForecast: 70, recommended: 55 },
  { name: "五目まぜご飯の素", recent: 12, weekForecast: 10, monthForecast: 45, recommended: 30 },
];

const trendData = [
  { week: "W1", actual: 70, forecast: null },
  { week: "W2", actual: 75, forecast: null },
  { week: "W3", actual: 68, forecast: null },
  { week: "W4", actual: 72, forecast: null },
  { week: "W5", actual: 75, forecast: null },
  { week: "W6", actual: null, forecast: 72 },
  { week: "W7", actual: null, forecast: 74 },
  { week: "W8", actual: null, forecast: 71 },
  { week: "W9", actual: null, forecast: 73 },
];

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
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <Select defaultValue="all">
          <SelectTrigger className="w-44 bg-secondary/50 border-border/50 h-10">
            <SelectValue placeholder="商品を選択" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全商品</SelectItem>
            {forecastData.map((d) => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </motion.div>

      {/* 注意バナー */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="glass-card p-4 border-edo-warning/20 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-edo-warning flex-shrink-0" />
        <p className="text-sm text-muted-foreground">
          予測精度はデータ蓄積に伴い向上します。現在はサンプルデータに基づく参考値です。
        </p>
      </motion.div>

      {/* トレンドグラフ */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">江戸一昆布 — 販売実績 + 予測</h3>
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
              {forecastData.map((d, i) => (
                <motion.tr key={d.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.04 }}
                  className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4 font-medium">{d.name}</td>
                  <td className="py-3 px-4 text-right font-num">{d.recent}</td>
                  <td className="py-3 px-4 text-right font-num">{d.weekForecast}</td>
                  <td className="py-3 px-4 text-right font-num">{d.monthForecast}</td>
                  <td className="py-3 px-4 text-right font-num font-semibold text-accent">{d.recommended}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default Forecast;
