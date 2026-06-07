import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import {
  FileSearch,
  Info,
  FileText,
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { parseTimestamp } from "@/lib/datetime";

// ── API レスポンス型（server/auto-created-products-service.ts と対応。日時はHTTP越しで文字列）──
type ReviewStatus = "all" | "needs_review" | "reviewed";

interface ImportSourceGuess {
  csvImportId: number;
  filename: string;
  csvType: string;
  importedAt: string;
  via: "SALES_RECORD" | "INVENTORY_TX";
  confidence: "inferred";
}

interface AutoCreatedProductRow {
  id: number;
  janCode: string;
  name: string;
  category: string;
  department: string;
  currentStock: number;
  reorderPoint: number;
  isAutoCreated: boolean;
  needsReview: boolean;
  isPlaceholderJan: boolean;
  createdAt: string;
  importSource: ImportSourceGuess | null;
}

interface AutoCreatedProductsResponse {
  products: AutoCreatedProductRow[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    autoCreatedTotal: number;
    needsReviewTotal: number;
    reviewedTotal: number;
    placeholderJanTotal: number;
  };
  sourceConfidence: "inferred";
  skippedRows: unknown[]; // Phase 2 用（MVP では表示しない）
}

const LIMIT = 100;

// csvType は enum ではなく自由文字列。未知/旧値は生の値をそのまま表示するフォールバックを必ず通す。
const CSV_TYPE_LABELS: Record<string, string> = {
  PRODUCT_SALES: "売上CSV",
  MONTHLY_SALES: "月次売上",
  PURCHASE_ETOILE: "仕入(エトワール)",
  PURCHASE_COREC: "仕入(コレック)",
  PURCHASE_JANNU: "仕入(ジャヌツー)",
};
const csvTypeLabel = (t: string): string => CSV_TYPE_LABELS[t] ?? t;

const VIA_LABELS: Record<string, string> = {
  SALES_RECORD: "売上記録から推定",
  INVENTORY_TX: "在庫変動から推定",
};
const viaLabel = (via: string): string => VIA_LABELS[via] ?? via;

const DEPARTMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "全部門" },
  { value: "FOOD", label: "食品" },
  { value: "APPAREL", label: "アパレル" },
  { value: "GOODS", label: "雑貨" },
];

const formatDate = (value: string): string =>
  parseTimestamp(value).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });

const AutoCreatedProducts = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const [data, setData] = useState<AutoCreatedProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ（変更時はサーバへ再問い合わせ＝query が変わる）
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("all");
  const [placeholderOnly, setPlaceholderOnly] = useState(false);
  const [search, setSearch] = useState("");
  // 部門は URL の ?department= があれば初期反映（既存の在庫/アラート画面と同じ全体フィルタ文脈に追従）
  const [department, setDepartment] = useState<string>(() => searchParams.get("department") || "ALL");
  const [offset, setOffset] = useState(0);

  // フィルタ変更時はページを先頭へ戻す共通ヘルパー
  const resetAndSet = (fn: () => void) => {
    fn();
    setOffset(0);
  };

  const fetchData = useCallback(
    (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("reviewStatus", reviewStatus);
      if (placeholderOnly) params.set("placeholderOnly", "true");
      if (search.trim()) params.set("search", search.trim());
      if (department !== "ALL") params.set("department", department);
      params.set("limit", String(LIMIT));
      params.set("offset", String(offset));

      fetch(`/api/inventory/auto-created-products?${params.toString()}`, { credentials: "include", signal })
        .then((r) => {
          if (r.status === 401) {
            window.location.href = "/login";
            return null;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((json: AutoCreatedProductsResponse | null) => {
          if (json) setData(json);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return; // 競合リクエストの中断は無視
          setError("一覧の取得に失敗しました");
          toast({ title: "エラー", description: "自動登録商品台帳の取得に失敗しました", variant: "destructive" });
        })
        .finally(() => setLoading(false));
    },
    [reviewStatus, placeholderOnly, search, department, offset, toast]
  );

  // フィルタ/ページ変更で再取得。検索の連打を抑えるため軽くデバウンスし、古いリクエストは中断する。
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => fetchData(ctrl.signal), 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fetchData]);

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + LIMIT, total);

  const summaryCards = [
    { label: "自動作成 総数", value: summary?.autoCreatedTotal ?? 0, accent: "text-foreground" },
    { label: "未確認", value: summary?.needsReviewTotal ?? 0, accent: "text-amber-400" },
    { label: "確認済み", value: summary?.reviewedTotal ?? 0, accent: "text-edo-success" },
    { label: "プレースホルダJAN", value: summary?.placeholderJanTotal ?? 0, accent: "text-foreground" },
  ];

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1">
        <div className="flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">自動登録・要確認商品台帳</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          取込で商品マスタに無いJANから自動作成された商品の read-only 監査台帳（確認済みも含む全件）。
        </p>
      </motion.div>

      {/* 取込元は推定である旨 + Phase 1 のスコープ注意書き */}
      {data?.sourceConfidence === "inferred" && (
        <div className="glass-card p-4 border border-amber-400/20 flex gap-3 text-sm">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-muted-foreground space-y-1">
            <p>
              「取込元」は SalesRecord / InventoryTransaction から
              <strong className="text-foreground">推定</strong>したものです（厳密な記録ではありません）。
            </p>
            <p>
              Smaregi・エトワール等で DB に記録されなかったスキップ行は Phase 1 では表示されません。
            </p>
          </div>
        </div>
      )}

      {/* 発注アラートとの役割の違い（確認操作はアラート側） */}
      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          発注アラート＝未確認商品の<strong className="text-foreground">対応キュー</strong>（確認操作はそちらで）。
        </span>
        <span>
          このページ＝確認済みも含む<strong className="text-foreground">read-only 監査台帳</strong>（操作なし）。
        </span>
        <Link to="/alerts" className="text-primary hover:underline">
          発注アラートへ →
        </Link>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map((c) => (
          <div key={c.label} className="glass-card p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={cn("text-2xl font-num font-bold mt-1", c.accent)}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="商品名 / JANで検索"
            value={search}
            onChange={(e) => resetAndSet(() => setSearch(e.target.value))}
            className="pl-9 bg-secondary/50 border-border/50"
          />
        </div>

        <Select value={reviewStatus} onValueChange={(v) => resetAndSet(() => setReviewStatus(v as ReviewStatus))}>
          <SelectTrigger className="w-[140px] bg-secondary/50 border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="needs_review">未確認</SelectItem>
            <SelectItem value="reviewed">確認済み</SelectItem>
          </SelectContent>
        </Select>

        <Select value={department} onValueChange={(v) => resetAndSet(() => setDepartment(v))}>
          <SelectTrigger className="w-[130px] bg-secondary/50 border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPARTMENT_OPTIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground px-2 cursor-pointer select-none">
          <Checkbox
            checked={placeholderOnly}
            onCheckedChange={(v) => resetAndSet(() => setPlaceholderOnly(v === true))}
          />
          プレースホルダJANのみ
        </label>
      </div>

      {/* 本体: ローディング / エラー / 空 / 表 */}
      {loading && !data ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card h-12 shimmer" />
          ))}
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-primary">{error}</div>
      ) : products.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-muted-foreground"
        >
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>該当する自動登録・要確認商品はありません</p>
        </motion.div>
      ) : (
        <>
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">JAN</th>
                  <th className="text-left py-2.5 px-3 font-medium">商品名</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">カテゴリ</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">部門</th>
                  <th className="text-right py-2.5 px-3 font-medium whitespace-nowrap">現在庫</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">状態</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">JAN種別</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">取込元（推定）</th>
                  <th className="text-left py-2.5 px-3 font-medium whitespace-nowrap">登録日</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/30 hover:bg-secondary/30 transition-colors align-top"
                  >
                    <td className="py-2.5 px-3 font-num whitespace-nowrap text-xs">{p.janCode}</td>
                    <td className="py-2.5 px-3">{p.name}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{p.category}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">{p.department}</td>
                    <td className="py-2.5 px-3 text-right font-num">{p.currentStock}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {p.needsReview ? (
                        <Badge className="text-xs bg-amber-400/15 text-amber-400 border-amber-400/30">未確認</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-border/50 text-muted-foreground">
                          確認済み
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {p.isPlaceholderJan ? (
                        <Badge className="text-xs bg-edo-warning/15 text-edo-warning border-edo-warning/30">
                          AUTO_ JAN
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {p.importSource ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1 text-foreground/80">
                            <FileText className="w-3 h-3 flex-shrink-0" />
                            {p.importSource.filename}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {csvTypeLabel(p.importSource.csvType)} ・ {formatDate(p.importSource.importedAt)}
                          </span>
                          <span className="text-[10px] text-muted-foreground italic">
                            {viaLabel(p.importSource.via)}（推定）
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">取込元不明（推定不可）</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-num whitespace-nowrap text-xs">{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ページネーション */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {rangeStart}–{rangeEnd} / 全 <span className="font-num">{total}</span> 件
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                前へ
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= total || loading}
                onClick={() => setOffset(offset + LIMIT)}
                className="gap-1"
              >
                次へ
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AutoCreatedProducts;
