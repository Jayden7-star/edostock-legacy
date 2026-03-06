import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import { FileDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface AbcProduct {
  id: number;
  name: string;
  category: string;
  sales: number;
  cumPct: number;
  rank: string;
}

interface AbcData {
  products: AbcProduct[];
  summary: Record<string, { count: number; salesPct: string }>;
  insight: string | null;
  dataStatus: string;
}

const rankColors = { A: "hsl(28, 45%, 64%)", B: "hsl(210, 70%, 55%)", C: "hsl(220, 10%, 45%)" };
const rankTextColors: Record<string, string> = { A: "text-accent", B: "text-edo-info", C: "text-muted-foreground" };

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
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<AbcData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/abc?period=${period}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast({ title: "エラー", description: "ABC分析データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [period, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-24 shimmer" />
        ))}
      </div>
    );
  }

  if (!data || data.dataStatus === "insufficient") {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36 bg-secondary/50 border-border/50 h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="week">週次</SelectItem>
              <SelectItem value="month">月次</SelectItem>
              <SelectItem value="quarter">3ヶ月</SelectItem>
              <SelectItem value="half">半年</SelectItem>
              <SelectItem value="year">年間</SelectItem>
            </SelectContent>
          </Select>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-12 text-center">
          <FileDown className="w-12 h-12 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground">売上データがありません</p>
          <p className="text-sm text-muted-foreground mt-1">CSVデータをインポートしてください</p>
        </motion.div>
      </div>
    );
  }

  const { products, summary, insight } = data;
  const ranks = ["A", "B", "C"];

  return (
    <div className="space-y-6">
      {/* 期間セレクタ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <Select value={period} onValueChange={setPeriod}>
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
        {ranks.map((rank, i) => (
          <motion.div
            key={rank}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass-card p-5 text-center"
          >
            <span className={cn("text-3xl font-bold font-num", rankTextColors[rank])}>{rank}</span>
            <p className="text-sm text-muted-foreground mt-2">
              {summary[rank]?.count || 0}品目 / 売上 {summary[rank]?.salesPct || "0%"}
            </p>
          </motion.div>
        ))}
      </div>

      {/* インサイト */}
      {insight && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="glass-card p-4 border-accent/20 flex items-center gap-3">
          <span className="text-lg">💡</span>
          <p className="text-sm" dangerouslySetInnerHTML={{
            __html: insight.replace(
              /(\d+品目)/g, '<span class="font-semibold text-accent font-num">$1</span>'
            ).replace(
              /(70%)/g, '<span class="font-semibold text-accent font-num">$1</span>'
            )
          }} />
        </motion.div>
      )}

      {/* パレート図 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">パレート図</h3>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={products.slice(0, 20)} margin={{ top: 5, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 20%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis yAxisId="left" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`} />
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
                  {products.filter((d) => tab === "all" || d.rank === tab).map((d) => (
                    <tr key={d.id} className="border-b border-border/30">
                      <td className="py-2 px-3"><Badge variant="outline" className="text-xs">{d.rank}</Badge></td>
                      <td className="py-2 px-3">{d.name}</td>
                      <td className="py-2 px-3 text-right font-num">¥{d.sales.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-num">{d.cumPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {products.filter((d) => tab === "all" || d.rank === tab).length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">該当する商品がありません</td></tr>
                  )}
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
