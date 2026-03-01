import { useLocation } from "react-router-dom";
import { User } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "ダッシュボード",
  "/inventory": "在庫一覧",
  "/import": "CSVインポート",
  "/alerts": "発注アラート",
  "/stocktake": "棚卸し",
  "/analytics/abc": "ABC分析",
  "/analytics/seasonal": "季節性分析",
  "/analytics/forecast": "需要予測",
  "/analytics/recommendations": "商品切替提案",
  "/settings/products": "商品マスタ",
  "/settings/users": "ユーザー管理",
};

const AppHeader = () => {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "EdoStock";

  return (
    <header className="h-16 border-b border-border/50 bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
      <h1 className="text-lg font-semibold tracking-wide">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm text-foreground/80">管理者</span>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
