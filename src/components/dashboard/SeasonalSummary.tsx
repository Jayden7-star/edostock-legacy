import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface MonthTrend {
  month: string;
  sales: number;
  prevYear: number | null;
}

interface SeasonalSummaryProps {
  department: string;
}

const SeasonalSummary = ({ department }: SeasonalSummaryProps) => {
  const navigate = useNavigate();
  const [monthlyTrend, setMonthlyTrend] = useState<MonthTrend[]>([]);
  const [dataStatus, setDataStatus] = useState<string>("loading");

  useEffect(() => {
    // department param accepted but seasonal API is store-level aggregate
    fetch("/api/analytics/seasonal", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setMonthlyTrend(data.monthlyTrend || []);
        setDataStatus(data.dataStatus || "insufficient");
      })
      .catch(() => setDataStatus("error"));
  }, [department]);

  // Sort by sales descending and take top 3
  const top3 = [...monthlyTrend]
    .filter((m) => m.sales > 0)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 3);

  const calcYoy = (current: number, prev: number | null): number | null => {
    if (!prev || prev === 0) return null;
    return Math.round(((current - prev) / prev) * 1000) / 10;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.5 }}
      className="glass-card p-5 lg:p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-edo-info" />
          <h3 className="text-base font-semibold">季節トレンドサマリー</h3>
        </div>
        <button
          onClick={() => navigate("/analytics/seasonal")}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          詳細を見る <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {dataStatus !== "ready" ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {dataStatus === "loading" ? "読み込み中…" : "売上データが不足しています"}
        </p>
      ) : top3.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">データなし</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground mb-1">売上上位月 TOP3（前年同月比）</p>
          {top3.map((m, i) => {
            const yoy = calcYoy(m.sales, m.prevYear);
            const positive = yoy !== null && yoy >= 0;
            return (
              <motion.div
                key={m.month}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.07, duration: 0.3 }}
                className="flex items-center gap-3 p-3 rounded-lg border bg-edo-info/5 border-edo-info/20"
              >
                <div className="w-8 h-8 rounded-lg bg-edo-info/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-num font-bold text-edo-info">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{m.month}</p>
                  <p className="text-xs font-num text-muted-foreground">
                    ¥{m.sales.toLocaleString()}
                  </p>
                </div>
                {yoy !== null ? (
                  <div className={`flex items-center gap-0.5 text-xs font-num font-semibold flex-shrink-0 ${positive ? "text-edo-success" : "text-primary"}`}>
                    {positive ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {positive ? "+" : ""}{yoy}%
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground flex-shrink-0">前年データなし</span>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

export default SeasonalSummary;
