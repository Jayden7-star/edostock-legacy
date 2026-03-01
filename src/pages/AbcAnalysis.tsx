import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart as RLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area,
} from "recharts";
import { cn } from "@/lib/utils";

const abcData = [
  { name: "タオル桜富士", sales: 81180, cumPct: 8.4 },
  { name: "特売1200", sales: 46800, cumPct: 13.2 },
  { name: "江戸一昆布", sales: 37175, cumPct: 17.1 },
  { name: "一口ほたて", sales: 23220, cumPct: 19.5 },
  { name: "ハット", sales: 18000, cumPct: 21.3 },
  { name: "パーカーXL", sales: 14000, cumPct: 22.8 },
  { name: "しそ巻き", sales: 12500, cumPct: 24.1 },
  { name: "ちりめん山椒", sales: 11000, cumPct: 25.2 },
  { name: "黒豆", sales: 9800, cumPct: 26.2 },
  { name: "ごま昆布", sales: 8500, cumPct: 27.1 },
  { name: "混ぜご飯", sales: 7200, cumPct: 27.8 },
  { name: "桜田夫", sales: 6100, cumPct: 28.5 },
].map((d, i, arr) => ({
  ...d,
  cumPct: Math.min(100, 8.4 + i * 8.3),
  rank: (8.4 + i * 8.3) <= 70 ? "A" : (8.4 + i * 8.3) <= 90 ? "B" : "C",
}));

const rankSummary = [
  { rank: "A", count: 8, salesPct: "70%", color: "text-accent" },
  { rank: "B", count: 15, salesPct: "20%", color: "text-edo-info" },
  { rank: "C", count: 42, salesPct: "10%", color: "text-muted-foreground" },
];

const rankColors = { A: "hsl(28, 45%, 64%)", B: "hsl(210, 70%, 55%)", C: "hsl(220, 10%, 45%)" };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="glass-card px-3 py-2 text-xs">
        <p className="font-medium mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="font-num">
            {p.name === "sales" ? `¥${p.value.toLocaleString()}` : `${p.value.toFixed(1)}%`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const AbcAnalysis = () => {
  return (
    <div className="space-y-6">
      {/* 期間セレクタ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <Select defaultValue="month">
          <SelectTrigger className="w-36 bg-secondary/50 border-border/50 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">週次</SelectItem>
            <SelectItem value="month">月次</SelectItem>
            <SelectItem value="quarter">3ヶ月</SelectItem>
            <SelectItem value="half">半年</SelectItem>
            <SelectItem value="year">年間</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* ランクサマリー */}
      <div className="grid grid-cols-3 gap-4">
        {rankSummary.map((r, i) => (
          <motion.div
            key={r.rank}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass-card p-5 text-center"
          >
            <span className={cn("text-3xl font-bold font-num", r.color)}>{r.rank}</span>
            <p className="text-sm text-muted-foreground mt-2">{r.count}品目 / 売上 {r.salesPct}</p>
          </motion.div>
        ))}
      </div>

      {/* インサイト */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="glass-card p-4 border-accent/20 flex items-center gap-3">
        <span className="text-lg">💡</span>
        <p className="text-sm">Aランク商品はわずか <span className="font-semibold text-accent font-num">8品目</span> で売上の <span className="font-semibold text-accent font-num">70%</span> を占めています。これらの在庫切れを防ぐことが最優先です。</p>
      </motion.div>

      {/* パレート図 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">パレート図</h3>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={abcData} margin={{ top: 5, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 20%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis yAxisId="left" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} tickFormatter={(v: number) => `${(v/10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <Bar yAxisId="left" dataKey="sales" fill="hsl(348, 78%, 58%)" radius={[4, 4, 0, 0]} opacity={0.8} />
              <Line yAxisId="right" dataKey="cumPct" stroke="hsl(28, 45%, 64%)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* ランク別テーブル */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card p-5">
        <Tabs defaultValue="A">
          <TabsList className="bg-secondary/50 mb-4">
            <TabsTrigger value="A">Aランク</TabsTrigger>
            <TabsTrigger value="B">Bランク</TabsTrigger>
            <TabsTrigger value="C">Cランク</TabsTrigger>
            <TabsTrigger value="all">すべて</TabsTrigger>
          </TabsList>
          {["A", "B", "C", "all"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">ランク</th>
                  <th className="text-left py-2 px-3 font-medium">商品名</th>
                  <th className="text-right py-2 px-3 font-medium">売上</th>
                  <th className="text-right py-2 px-3 font-medium">累積構成比</th>
                </tr></thead>
                <tbody>
                  {abcData.filter((d) => tab === "all" || d.rank === tab).map((d) => (
                    <tr key={d.name} className="border-b border-border/30">
                      <td className="py-2 px-3"><Badge variant="outline" className="text-xs">{d.rank}</Badge></td>
                      <td className="py-2 px-3">{d.name}</td>
                      <td className="py-2 px-3 text-right font-num">¥{d.sales.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-num">{d.cumPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabsContent>
          ))}
        </Tabs>
      </motion.div>
    </div>
  );
};

export default AbcAnalysis;
