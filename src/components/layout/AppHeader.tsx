import { useLocation, Link, useSearchParams, useNavigate } from "react-router-dom";
import { User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const DEPT_FILTER_PAGES = new Set([
  "/", "/inventory", "/alerts",
  "/analytics/abc", "/analytics/seasonal", "/analytics/forecast", "/analytics/recommendations",
]);

const deptOptions = [
  { value: "all", label: "全部門" },
  { value: "FOOD", label: "食品" },
  { value: "APPAREL", label: "アパレル" },
  { value: "GOODS", label: "雑貨" },
];

const deptModeLabel: Record<string, string> = {
  FOOD: "食品モード",
  APPAREL: "アパレルモード",
  GOODS: "雑貨モード",
};

interface AppHeaderProps {
  user?: { name: string; role: string };
}

const AppHeader = ({ user }: AppHeaderProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const title = pageTitles[location.pathname] || "EdoStock";
  const showDeptFilter = DEPT_FILTER_PAGES.has(location.pathname);
  const department = searchParams.get("department") || "all";
  const modeLabel = deptModeLabel[department];

  const handleDeptChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("department");
    } else {
      params.set("department", value);
    }
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-wide">{title}</h1>
        {modeLabel && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
            {modeLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showDeptFilter && (
          <Select value={department} onValueChange={handleDeptChange}>
            <SelectTrigger className="w-[130px] h-9 bg-secondary/50 border-border/50 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deptOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
