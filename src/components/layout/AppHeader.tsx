import { useLocation, Link } from "react-router-dom";
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
  "/settings/smaregi": "スマレジ連携",
};

interface AppHeaderProps {
  user?: { name: string; role: string };
}

const AppHeader = ({ user }: AppHeaderProps) => {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "EdoStock";

  return (
    <header className="h-16 border-b border-border/50 bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
      <h1 className="text-lg font-semibold tracking-wide">{title}</h1>
      <div className="flex items-center gap-3">
        <Link to="/settings/users" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary/80 transition-all">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm text-foreground/80 hover:text-foreground transition-colors">{user?.name || "管理者"}</span>
        </Link>
      </div>
    </header>
  );
};

export default AppHeader;
