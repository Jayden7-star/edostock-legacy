import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Lightbulb, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const RecommendationBanner = () => {
  const [count, setCount] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/analytics/recommendations", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setCount(data.recommendations?.length || 0))
      .catch(() => setCount(0));
  }, []);

  // データ取得中 or 0件なら非表示
  if (count === null || count === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.5 }}
      className="glass-card p-5 lg:p-6 border-accent/20"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Lightbulb className="w-6 h-6 text-accent" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold mb-0.5">商品切替提案</h3>
          <p className="text-xs text-muted-foreground">
            <span className="font-num font-semibold text-accent">{count}件</span>の商品について入替の検討をおすすめします
          </p>
        </div>
        <button
          onClick={() => navigate("/analytics/recommendations")}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors whitespace-nowrap"
        >
          詳細を見る <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
};

export default RecommendationBanner;
