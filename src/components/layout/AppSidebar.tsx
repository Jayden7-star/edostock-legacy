import { useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Package,
  FileDown,
  Bell,
  ClipboardList,
  BarChart3,
  TrendingUp,
  LineChart,
  Lightbulb,
  Settings,
  ChevronLeft,
  ChevronDown,
  Database,
  Users,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: { label: string; icon: React.ElementType; path: string }[];
}

const navItems: NavItem[] = [
  { label: "ダッシュボード", icon: LayoutDashboard, path: "/" },
  { label: "在庫一覧", icon: Package, path: "/inventory" },
  { label: "CSVインポート", icon: FileDown, path: "/import" },
  { label: "発注アラート", icon: Bell, path: "/alerts" },
  { label: "棚卸し", icon: ClipboardList, path: "/stocktake" },
  {
    label: "分析",
    icon: BarChart3,
    children: [
      { label: "ABC分析", icon: BarChart3, path: "/analytics/abc" },
      { label: "季節性分析", icon: LineChart, path: "/analytics/seasonal" },
      { label: "需要予測", icon: TrendingUp, path: "/analytics/forecast" },
      { label: "商品切替提案", icon: Lightbulb, path: "/analytics/recommendations" },
    ],
  },
  {
    label: "設定",
    icon: Settings,
    children: [
      { label: "商品マスタ", icon: Database, path: "/settings/products" },
      { label: "ユーザー管理", icon: Users, path: "/settings/users" },
      { label: "スマレジ連携", icon: RefreshCw, path: "/settings/smaregi" },
    ],
  },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const AppSidebar = ({ collapsed, onToggle }: AppSidebarProps) => {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["分析", "設定"]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  };

  const isActive = (path?: string) => path === location.pathname;
  const isGroupActive = (item: NavItem) =>
    item.children?.some((c) => c.path === location.pathname);

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border z-40 flex flex-col"
    >
      {/* ロゴ */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-3 min-w-0 cursor-pointer">
          <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold edo-gradient-text">江</span>
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                <h2 className="text-sm font-bold edo-gradient-text">EdoStock</h2>
                <p className="text-[10px] text-muted-foreground">在庫管理</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          if (item.children) {
            const groupActive = isGroupActive(item);
            const isExpanded = expandedGroups.includes(item.label);
            return (
              <div key={item.label}>
                <button
                  onClick={() => !collapsed && toggleGroup(item.label)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                    groupActive
                      ? "text-sidebar-primary-foreground bg-sidebar-accent"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex-1 text-left"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {!collapsed && (
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform",
                        isExpanded && "rotate-180"
                      )}
                    />
                  )}
                </button>
                <AnimatePresence>
                  {isExpanded && !collapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden ml-4 mt-1 space-y-0.5"
                    >
                      {item.children.map((child) => (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                            isActive(child.path)
                              ? "text-primary bg-primary/10 border-l-2 border-primary"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                          )}
                        >
                          <child.icon className="w-4 h-4 flex-shrink-0" />
                          <span>{child.label}</span>
                        </NavLink>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path!}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                isActive(item.path)
                  ? "text-primary bg-primary/10 border-l-2 border-primary font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
          );
        })}
      </nav>

      {/* 折りたたみ＋ログアウト */}
      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
            window.location.href = "/login";
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>ログアウト</span>}
        </button>
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center py-2 rounded-lg text-muted-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <ChevronLeft
            className={cn("w-4 h-4 transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>
    </motion.aside >
  );
};

export default AppSidebar;
