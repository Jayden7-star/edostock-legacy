import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface AbcProduct {
  id: number;
  name: string;
  category: string;
  sales: number;
  cumPct: number;
  rank: "A" | "B" | "C";
}

interface AbcSummaryProps {
  department: string;
}

const AbcSummary = ({ department }: AbcSummaryProps) => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<AbcProduct[]>([]);
  const [dataStatus, setDataStatus] = useState<string>("loading");

  useEffect(() => {
    const url = department
      ? `/api/analytics/abc?period=month&department=${department}`
      : "/api/analytics/abc?period=month";
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setProducts(data.products || []);
        setDataStatus(data.dataStatus || "insufficient");
      })
      .catch(() => setDataStatus("error"));
  }, [department]);

  const aTop3 = products.filter((p) => p.rank === "A").slice(0, 3);
  const cTop3 = products.filter((p) => p.rank === "C").slice(-3).reverse();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.5 }}
      className="glass-card p-5 lg:p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-edo-gold" />
          <h3 className="text-base font-semibold">ABC分析サマリー</h3>
        </div>
        <button
          onClick={() => navigate("/analytics/abc")}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          詳細を見る <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {dataStatus !== "ready" ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {dataStatus === "loading" ? "読み込み中…" : "売上データが不足しています"}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Aランク TOP3 */}
          <div>
            <p className="text-xs font-semibold text-edo-success mb-2">Aランク（売上上位）TOP3</p>
            <div className="space-y-2">
              {aTop3.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">データなし</p>
              ) : (
                aTop3.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.55 + i * 0.06, duration: 0.3 }}
                    className="flex items-center gap-2 p-2.5 rounded-lg border bg-edo-success/5 border-edo-success/20"
                  >
                    <span className="text-xs font-num font-bold text-edo-success w-4 flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.category}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 bg-edo-success/15 text-edo-success border-edo-success/30 flex-shrink-0"
                    >
                      A
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Cランク TOP3 */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Cランク（低売上）TOP3</p>
            <div className="space-y-2">
              {cTop3.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">データなし</p>
              ) : (
                cTop3.map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.55 + i * 0.06, duration: 0.3 }}
                    className="flex items-center gap-2 p-2.5 rounded-lg border bg-secondary/30 border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.category}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] py-0 flex-shrink-0">
                      C
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default AbcSummary;
