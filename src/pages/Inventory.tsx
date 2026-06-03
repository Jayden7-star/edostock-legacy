import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Package, Plus, Pencil, EyeOff, Eye, List, LayoutGrid, AlertTriangle, Save, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { parseActualStockClient } from "@/lib/inventory-input";
import { useSearchParams } from "react-router-dom";

interface Product {
  id: number;
  name: string;
  janCode: string;
  color: string | null;
  size: string | null;
  category: { displayName: string } | null;
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  sellingPrice: number;
  costPrice: number;
  isActive: boolean;
}

type ViewMode = "list" | "grid";
type IsActiveFilter = "true" | "false" | "all";
type SessionRole = "ADMIN" | "STAFF";

// 未保存の在庫調整（フロント上の一時変更）。productId をキーに Map で保持する。
// beforeStock は差分表示用に保持するだけで、保存時はサーバが live を再取得して差分を計算する。
interface StagedEdit {
  actualStock: number;
  beforeStock: number;
  note?: string;
}

const formatDiff = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "±0");

const STORAGE_KEY = "edostock-inventory-view";

const stockStatuses = ["すべて", "在庫切れ", "発注点以下", "十分"];

type StockStatus = "outOfStock" | "belowReorder" | "sufficient";

const getStockStatus = (p: Product): StockStatus => {
  if (p.currentStock === 0) return "outOfStock";
  if (p.currentStock <= p.reorderPoint) return "belowReorder";
  return "sufficient";
};

const statusConfig: Record<StockStatus, { label: string; dot: string; bg: string }> = {
  outOfStock: { label: "在庫切れ", dot: "bg-primary", bg: "text-primary" },
  belowReorder: { label: "発注点以下", dot: "bg-edo-warning", bg: "text-edo-warning" },
  sufficient: { label: "十分", dot: "bg-edo-success", bg: "text-edo-success" },
};

const getCategoryName = (p: Product): string =>
  p.category?.displayName || "未分類";

type ColorChipStyle = { background: string; border?: string } | null;

const colorMap: Record<string, { background: string; border?: string }> = {
  // 日本語カラー名
  "ブラック": { background: "#1A1A1A" },
  "ネイビー": { background: "#1B2A4A" },
  "インディゴ": { background: "#3F51B5" },
  "カブラウン": { background: "#8B6914" },
  "ブラウン": { background: "#8B4513" },
  "ダークブラウン": { background: "#5C4033" },
  "アイボリー": { background: "#FFFFF0", border: "1px solid #D5D5C8" },
  "ホワイト": { background: "#FFFFFF", border: "1px solid #D5D5D5" },
  "オフホワイト": { background: "#FAF0E6", border: "1px solid #D5D5C8" },
  "グリーン": { background: "#228B22" },
  "カーキ": { background: "#6B7B3A" },
  "オリーブ": { background: "#6B8E23" },
  "ミント": { background: "#2E8B8B" },
  "レッド": { background: "#DC143C" },
  "ワイン": { background: "#722F37" },
  "ボルドー": { background: "#6C1D45" },
  "ピンク": { background: "#F4C2C2" },
  "ベビーピンク": { background: "#F4C2C2" },
  "ブルー": { background: "#4169E1" },
  "ライトブルー": { background: "#87CEEB" },
  "サックス": { background: "#87CEEB" },
  "イエロー": { background: "#FFE135" },
  "バナナ": { background: "#FFE135" },
  "マスタード": { background: "#E1AD01" },
  "グレー": { background: "#808080" },
  "チャコール": { background: "#36454F" },
  "ベージュ": { background: "#D4C5A9", border: "1px solid #BFB699" },
  "パープル": { background: "#7B2D8E" },
  "ラベンダー": { background: "#B57EDC" },
  "オレンジ": { background: "#ED6D1F" },
  // アルファベット略称
  "BK": { background: "#1A1A1A" },
  "NV": { background: "#1B2A4A" },
  "GR": { background: "#228B22" },
  "BP": { background: "#F4C2C2" },
  "LB": { background: "#87CEEB" },
  "DB": { background: "#5C4033" },
  "WH": { background: "#FFFFFF", border: "1px solid #D5D5D5" },
  "IV": { background: "#FFFFF0", border: "1px solid #D5D5C8" },
  "BE": { background: "#D4C5A9", border: "1px solid #BFB699" },
  "RD": { background: "#DC143C" },
  "BL": { background: "#4169E1" },
  "YE": { background: "#FFE135" },
  "OR": { background: "#ED6D1F" },
  "GY": { background: "#808080" },
  "KH": { background: "#6B7B3A" },
  "PP": { background: "#7B2D8E" },
  "CR": { background: "#FFFDD0", border: "1px solid #D5D5C8" },
};

const getColorChip = (name: string, color?: string | null): ColorChipStyle => {
  // colorフィールドを優先、なければ商品名からマッチ
  const text = color || name;

  // 長いキーから順にマッチ（部分一致）
  const keys = Object.keys(colorMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (text.includes(key)) return colorMap[key];
  }

  return null;
};

const Inventory = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("すべて");
  const [stockFilter, setStockFilter] = useState("すべて");
  const [isActiveFilter, setIsActiveFilter] = useState<IsActiveFilter>("true");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [sessionRole, setSessionRole] = useState<SessionRole | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"purchase" | "adjust">("purchase");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 未保存の在庫調整（一括保存まで DB に書き込まない）
  const [edits, setEdits] = useState<Map<number, StagedEdit>>(new Map());
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ViewMode) || "list";
  });
  const { toast } = useToast();
  const scrollYRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) setSessionRole(data.user.role);
      })
      .catch(() => { /* AppLayout がリダイレクト処理 */ });
  }, []);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ isActive: isActiveFilter });
    if (department) params.set("department", department);
    fetch(`/api/products?${params.toString()}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { if (data) setProducts(data); })
      .catch(() => toast({ title: "エラー", description: "在庫データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [department, isActiveFilter, toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // フィルタ切替時は選択状態をリセット
  useEffect(() => {
    setSelectedIds(new Set());
  }, [isActiveFilter, department, category, stockFilter, search]);

  useEffect(() => {
    if (shouldRestoreScrollRef.current) {
      window.scrollTo(0, scrollYRef.current);
      shouldRestoreScrollRef.current = false;
    }
  }, [products]);

  // Build categories dynamically from product data
  const categories = [
    "すべて",
    ...Array.from(new Set(products.map(getCategoryName))).filter((c) => c !== ""),
  ];

  const filtered = products.filter((p) => {
    const matchSearch = p.name.includes(search) || p.janCode.includes(search);
    const matchCat = category === "すべて" || getCategoryName(p) === category;
    const status = getStockStatus(p);
    const matchStatus =
      stockFilter === "すべて" ||
      (stockFilter === "在庫切れ" && status === "outOfStock") ||
      (stockFilter === "発注点以下" && status === "belowReorder") ||
      (stockFilter === "十分" && status === "sufficient");
    return matchSearch && matchCat && matchStatus;
  });

  const isAdmin = sessionRole === "ADMIN";
  const selectionEnabled = isAdmin;
  const selectedCount = selectedIds.size;
  const allFilteredChecked = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someFilteredChecked = filtered.some((p) => selectedIds.has(p.id));
  const headerCheckedState: boolean | "indeterminate" = allFilteredChecked
    ? true
    : someFilteredChecked
      ? "indeterminate"
      : false;

  const selectedProducts = products.filter((p) => selectedIds.has(p.id));
  const showBulkActivate = isActiveFilter !== "true" && selectedProducts.some((p) => !p.isActive);
  const showBulkDeactivate = isActiveFilter !== "false" && selectedProducts.some((p) => p.isActive);

  const toggleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((p) => next.add(p.id));
      else filtered.forEach((p) => next.delete(p.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const grossMargin = (p: Product) =>
    p.costPrice > 0 ? (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(1) : "—";

  const openModal = (p: Product, type: "purchase" | "adjust") => {
    setSelectedProduct(p);
    setModalType(type);
    if (type === "adjust") {
      // 既に未保存変更があればその値を、なければ現在庫を初期表示
      const staged = edits.get(p.id);
      setQuantity(String(staged ? staged.actualStock : p.currentStock));
      setNote(staged?.note ?? "");
    } else {
      setQuantity("");
      setNote("");
    }
    setModalOpen(true);
  };

  // ===== 在庫調整のステージング（一時変更）と一括保存 =====

  // 調整後在庫を未保存変更として保持する。現在庫と同値なら変更として扱わず削除する。
  const stageEdit = (product: Product, actualStock: number, editNote?: string) => {
    setEdits((prev) => {
      const next = new Map(prev);
      if (actualStock === product.currentStock) {
        next.delete(product.id);
      } else {
        next.set(product.id, { actualStock, beforeStock: product.currentStock, note: editNote });
      }
      return next;
    });
  };

  const handleStageAdjust = () => {
    if (!selectedProduct) return;
    const parsed = parseActualStockClient(quantity);
    if (!parsed.ok) return; // ボタンは無効化済みだが二重ガード
    stageEdit(selectedProduct, parsed.value, note.trim() || undefined);
    setModalOpen(false);
  };

  const discardAll = () => {
    if (edits.size === 0) return;
    if (!confirm(`未保存の変更 ${edits.size} 件をすべて破棄しますか？`)) return;
    setEdits(new Map());
  };

  const handleBatchSave = async () => {
    if (saving || edits.size === 0) return; // 二重送信ガード
    setSaving(true);
    try {
      const items = Array.from(edits.entries()).map(([productId, e]) => ({
        productId,
        actualStock: e.actualStock,
        note: e.note,
      }));
      const res = await fetch("/api/inventory/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "エラー", description: data.error || "一括保存に失敗しました", variant: "destructive" });
        return;
      }
      // ページ全体をリロードせず、サーバ応答の確定値で在庫表示を更新する
      const updatedMap = new Map<number, number>(
        (data.updated ?? []).map((u: { id: number; currentStock: number }) => [u.id, u.currentStock])
      );
      setProducts((prev) =>
        prev.map((p) => (updatedMap.has(p.id) ? { ...p, currentStock: updatedMap.get(p.id)! } : p))
      );
      setEdits(new Map()); // 未保存状態をクリア
      toast({ title: "一括保存完了", description: `${data.updated?.length ?? items.length}件の在庫を更新しました` });
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const changedCount = edits.size;
  const totalDiff = Array.from(edits.values()).reduce((sum, e) => sum + (e.actualStock - e.beforeStock), 0);

  const adjustValidation = modalType === "adjust" ? parseActualStockClient(quantity) : null;
  const adjustInvalid = modalType === "adjust" && !adjustValidation?.ok;

  // モーダル下のヒント/エラー文言（discriminated union を if/else で確実に絞り込む）
  let adjustHint: { tone: "error" | "info"; text: string } | null = null;
  if (modalType === "adjust" && adjustValidation) {
    if (adjustValidation.ok) {
      if (selectedProduct) {
        adjustHint = {
          tone: "info",
          text: `差分 ${formatDiff(adjustValidation.value - selectedProduct.currentStock)} ／ 確定すると未保存の変更として保持されます（下部の「一括保存」でまとめて保存）`,
        };
      }
    } else {
      adjustHint = { tone: "error", text: adjustValidation.error };
    }
  }

  // 未保存変更がある間はリロード・タブ閉じ・ブラウザ遷移を警告する
  useEffect(() => {
    if (edits.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [edits.size]);

  const handleDeactivate = async (p: Product) => {
    if (!confirm(`「${p.name}」を終売にして一覧から非表示にしますか？\n（売上分析データは保持されます）`)) return;
    const savedScrollY = window.scrollY;
    try {
      await fetch(`/api/inventory/${p.id}/deactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      toast({ title: "終売設定完了", description: `${p.name}を非表示にしました` });
      scrollYRef.current = savedScrollY;
      shouldRestoreScrollRef.current = true;
      fetchProducts();
    } catch {
      toast({ title: "エラー", description: "処理に失敗しました", variant: "destructive" });
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
    }
  };

  const handleActivate = async (p: Product) => {
    const savedScrollY = window.scrollY;
    try {
      const res = await fetch(`/api/products/${p.id}/activate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "有効化完了", description: `${p.name}を有効にしました` });
      scrollYRef.current = savedScrollY;
      shouldRestoreScrollRef.current = true;
      fetchProducts();
    } catch {
      toast({ title: "エラー", description: "有効化に失敗しました", variant: "destructive" });
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
    }
  };

  const handleBulkActivate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/products/bulk-activate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast({ title: "一括有効化完了", description: `${data.updated ?? ids.length}件を有効化しました` });
      clearSelection();
      fetchProducts();
    } catch {
      toast({ title: "エラー", description: "一括有効化に失敗しました", variant: "destructive" });
    }
  };

  const handleBulkDeactivate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/products/bulk-deactivate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast({ title: "一括無効化完了", description: `${data.updated ?? ids.length}件を無効化しました` });
      clearSelection();
      setBulkDeactivateOpen(false);
      fetchProducts();
    } catch {
      toast({ title: "エラー", description: "一括無効化に失敗しました", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !quantity) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity: parseInt(quantity),
          note: note || undefined,
          type: modalType === "purchase" ? "PURCHASE" : "ADJUSTMENT",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: modalType === "purchase" ? "入庫完了" : "在庫調整完了",
          description: `${selectedProduct.name}: 在庫 → ${data.newStock}`,
        });
        setModalOpen(false);
        scrollYRef.current = window.scrollY;
        shouldRestoreScrollRef.current = true;
        fetchProducts();
      } else {
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-16 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", changedCount > 0 && "pb-24")}>
      {/* フィルタバー */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4 flex flex-wrap items-center gap-3"
      >
        <div className="relative w-full md:w-auto md:flex-1 md:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="商品名・JANコードで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/50 border-border/50 h-10"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[160px] bg-secondary/50 border-border/50 h-10">
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-[140px] bg-secondary/50 border-border/50 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stockStatuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={isActiveFilter} onValueChange={(v) => setIsActiveFilter(v as IsActiveFilter)}>
          <SelectTrigger className="w-[140px] bg-secondary/50 border-border/50 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">有効のみ</SelectItem>
            <SelectItem value="false">無効のみ</SelectItem>
            <SelectItem value="all">すべて</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto bg-secondary/50 rounded-lg p-1 border border-border/50">
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-8 w-8 p-0",
              viewMode === "list" && "bg-primary/20 text-primary"
            )}
            onClick={() => toggleViewMode("list")}
            title="リスト表示"
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-8 w-8 p-0",
              viewMode === "grid" && "bg-primary/20 text-primary"
            )}
            onClick={() => toggleViewMode("grid")}
            title="ブロック表示"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>

      {/* 一括操作バー */}
      {selectionEnabled && selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-3 flex flex-wrap items-center gap-3"
        >
          <span className="text-sm font-medium">{selectedCount}件選択中</span>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            選択解除
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {showBulkActivate && (
              <Button
                size="sm"
                className="bg-edo-success/90 hover:bg-edo-success text-white"
                onClick={handleBulkActivate}
              >
                <Eye className="w-4 h-4 mr-1" />
                一括有効化
              </Button>
            )}
            {showBulkDeactivate && (
              <Button
                size="sm"
                variant="outline"
                className="border-edo-warning/60 text-edo-warning hover:bg-edo-warning/10"
                onClick={() => setBulkDeactivateOpen(true)}
              >
                <EyeOff className="w-4 h-4 mr-1" />
                一括無効化
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {/* リスト表示 */}
      {viewMode === "list" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="glass-card overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  {selectionEnabled && (
                    <th className="py-3 pl-4 pr-2 w-10">
                      <Checkbox
                        checked={headerCheckedState}
                        onCheckedChange={(v) => toggleAllFiltered(v === true)}
                        aria-label="表示中の全件を選択"
                      />
                    </th>
                  )}
                  <th className="text-left py-3 px-4 font-medium">状態</th>
                  <th className="text-left py-3 px-4 font-medium">商品名</th>
                  <th className="hidden md:table-cell text-left py-3 px-4 font-medium">部門</th>
                  <th className="text-right py-3 px-4 font-medium">現在庫</th>
                  <th className="hidden md:table-cell text-right py-3 px-4 font-medium">発注点</th>
                  <th className="hidden md:table-cell text-right py-3 px-4 font-medium">適正在庫</th>
                  <th className="hidden md:table-cell text-right py-3 px-4 font-medium">売価</th>
                  <th className="hidden md:table-cell text-right py-3 px-4 font-medium">原価</th>
                  <th className="hidden md:table-cell text-right py-3 px-4 font-medium">粗利率</th>
                  <th className="text-center py-3 px-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const status = getStockStatus(p);
                  const cfg = statusConfig[status];
                  const chip = getColorChip(p.name, p.color);
                  const checked = selectedIds.has(p.id);
                  const edit = edits.get(p.id);
                  return (
                    <motion.tr
                      key={p.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className={cn(
                        "border-b border-border/30 hover:bg-secondary/30 transition-colors",
                        !p.isActive && "opacity-50",
                        checked && "bg-primary/5",
                        edit && "bg-edo-warning/5"
                      )}
                    >
                      {selectionEnabled && (
                        <td className="py-3 pl-4 pr-2 w-10">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleOne(p.id, v === true)}
                            aria-label={`${p.name}を選択`}
                          />
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                          <span className={cn("text-xs", cfg.bg)}>{cfg.label}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {p.name}
                        {chip && (
                          <span
                            style={{
                              ...chip,
                              display: "inline-block",
                              width: 20,
                              height: 12,
                              borderRadius: 3,
                              marginLeft: 6,
                              verticalAlign: "middle",
                            }}
                          />
                        )}
                        {edit && (
                          <Badge className="ml-2 bg-edo-warning/20 text-edo-warning border-edo-warning/40 text-[10px] px-1.5 py-0 align-middle">
                            未保存
                          </Badge>
                        )}
                      </td>
                      <td className="hidden md:table-cell py-3 px-4">
                        <Badge variant="outline" className="text-xs border-border/50">{getCategoryName(p)}</Badge>
                      </td>
                      <td className={cn("py-3 px-4 text-right font-num font-semibold", !edit && cfg.bg)}>
                        {edit ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span>
                              <span className="text-muted-foreground line-through mr-1">{p.currentStock}</span>
                              <span className="text-edo-warning">→ {edit.actualStock}</span>
                            </span>
                            <span className="text-[10px] text-edo-warning font-normal">
                              差分 {formatDiff(edit.actualStock - edit.beforeStock)}
                            </span>
                          </div>
                        ) : (
                          p.currentStock
                        )}
                      </td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">{p.reorderPoint}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">{p.optimalStock}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">¥{p.costPrice.toLocaleString()}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num">{grossMargin(p)}%</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          {p.isActive ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-edo-success hover:text-edo-success hover:bg-edo-success/10"
                                onClick={() => openModal(p, "purchase")}
                                title="入庫"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => openModal(p, "adjust")}
                                title="調整"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-edo-warning hover:bg-edo-warning/10"
                                onClick={() => handleDeactivate(p)}
                                title="非表示"
                              >
                                <EyeOff className="w-4 h-4" />
                              </Button>
                            </>
                          ) : isAdmin ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-edo-success hover:text-edo-success hover:bg-edo-success/10"
                              onClick={() => handleActivate(p)}
                              title="有効化"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={selectionEnabled ? 11 : 10} className="py-12 text-center text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>該当する商品がありません</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ブロック表示 */}
      {viewMode === "grid" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          {filtered.length === 0 && !loading ? (
            <div className="glass-card py-12 text-center text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>該当する商品がありません</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {filtered.map((p, i) => {
                const status = getStockStatus(p);
                const cfg = statusConfig[status];
                const isLowStock = p.currentStock <= 5;
                const chip = getColorChip(p.name, p.color);
                const checked = selectedIds.has(p.id);
                const edit = edits.get(p.id);
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={cn(
                      "glass-card-hover p-4 flex flex-col gap-3 relative",
                      isLowStock && "border-edo-warning/50",
                      !p.isActive && "opacity-50",
                      checked && "ring-2 ring-primary/60",
                      edit && "ring-2 ring-edo-warning/60"
                    )}
                  >
                    {selectionEnabled && (
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleOne(p.id, v === true)}
                        className="absolute left-2 top-2 z-10 bg-background/80"
                        aria-label={`${p.name}を選択`}
                      />
                    )}
                    {/* ヘッダー: 商品名 + ステータス */}
                    <div className={cn("flex items-start justify-between gap-2", selectionEnabled && "pl-6")}>
                      <h3 className="text-sm font-semibold leading-tight line-clamp-2 flex-1">
                        {p.name}
                        {chip && (
                          <span
                            style={{
                              ...chip,
                              display: "inline-block",
                              width: 20,
                              height: 12,
                              borderRadius: 3,
                              marginLeft: 6,
                              verticalAlign: "middle",
                            }}
                          />
                        )}
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {edit && (
                          <Badge className="bg-edo-warning/20 text-edo-warning border-edo-warning/40 text-[10px] px-1.5 py-0">
                            未保存
                          </Badge>
                        )}
                        <div className={cn("w-2 h-2 rounded-full mt-1.5", cfg.dot)} title={cfg.label} />
                      </div>
                    </div>

                    {/* カラー・サイズ */}
                    <div className="flex flex-wrap gap-1.5">
                      {p.color && (
                        <Badge variant="outline" className="text-xs border-border/50 px-2 py-0">{p.color}</Badge>
                      )}
                      {p.size && (
                        <Badge variant="outline" className="text-xs border-border/50 px-2 py-0">{p.size}</Badge>
                      )}
                    </div>

                    {/* 在庫数 */}
                    {edit ? (
                      <div className="rounded-lg px-3 py-2 bg-edo-warning/10 space-y-0.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">現在庫</span>
                          <span className="ml-auto font-num">
                            <span className="text-muted-foreground line-through mr-1">{p.currentStock}</span>
                            <span className="text-edo-warning font-bold text-base">→ {edit.actualStock}</span>
                          </span>
                        </div>
                        <div className="flex items-center text-[11px]">
                          <span className="text-muted-foreground">差分</span>
                          <span className="ml-auto text-edo-warning font-num font-semibold">
                            {formatDiff(edit.actualStock - edit.beforeStock)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2",
                        isLowStock ? "bg-edo-warning/10" : "bg-secondary/50"
                      )}>
                        {isLowStock && <AlertTriangle className="w-3.5 h-3.5 text-edo-warning shrink-0" />}
                        <span className="text-xs text-muted-foreground">在庫</span>
                        <span className={cn(
                          "ml-auto text-lg font-bold font-num",
                          isLowStock ? "text-edo-warning" : cfg.bg
                        )}>
                          {p.currentStock}
                        </span>
                      </div>
                    )}

                    {/* 売価 */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">売価</span>
                      <span className="font-num font-semibold">¥{p.sellingPrice.toLocaleString()}</span>
                    </div>

                    {/* 操作ボタン */}
                    <div className="flex items-center justify-end gap-1 mt-auto pt-2 border-t border-border/30">
                      {p.isActive ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-edo-success hover:text-edo-success hover:bg-edo-success/10"
                            onClick={() => openModal(p, "purchase")}
                            title="入庫"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openModal(p, "adjust")}
                            title="調整"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-edo-warning hover:bg-edo-warning/10"
                            onClick={() => handleDeactivate(p)}
                            title="非表示"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : isAdmin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-edo-success hover:text-edo-success hover:bg-edo-success/10"
                          onClick={() => handleActivate(p)}
                          title="有効化"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* 一括無効化 確認ダイアログ */}
      <AlertDialog open={bulkDeactivateOpen} onOpenChange={setBulkDeactivateOpen}>
        <AlertDialogContent className="bg-card border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedCount}件を無効化しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <ul className="list-disc pl-5 text-sm">
                  {selectedProducts.slice(0, 3).map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                </ul>
                {selectedCount > 3 && (
                  <p className="text-sm text-muted-foreground">他 {selectedCount - 3} 件</p>
                )}
                <p className="text-sm">無効化された商品は一覧から非表示になります（売上分析データは保持されます）。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeactivate}
              className="bg-edo-warning hover:bg-edo-warning/90 text-white"
            >
              無効化する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 未保存変更の固定バー */}
      {changedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-card/95 backdrop-blur-md shadow-lg"
        >
          <div className="px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{changedCount}件の未保存変更</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">差分合計</span>
              <span
                className={cn(
                  "font-num font-semibold",
                  totalDiff > 0 ? "text-edo-success" : totalDiff < 0 ? "text-primary" : "text-muted-foreground"
                )}
              >
                {formatDiff(totalDiff)}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={discardAll} disabled={saving}>
                <Trash2 className="w-4 h-4 mr-1" />
                変更を破棄
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90"
                onClick={handleBatchSave}
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-1" />
                {saving ? "保存中..." : "一括保存"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* 入庫/調整モーダル */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>
              {modalType === "purchase" ? "📥 入庫記録" : "✏️ 在庫調整"} — {selectedProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>現在庫: <span className="font-num font-semibold">{selectedProduct?.currentStock}</span></Label>
            </div>
            <div className="space-y-2">
              <Label>{modalType === "purchase" ? "入庫数量" : "調整後在庫数"}</Label>
              <Input
                type="number"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={cn(
                  "bg-secondary/50 border-border/50 h-11",
                  adjustInvalid && quantity !== "" && "border-primary/60"
                )}
              />
              {adjustHint && (
                <p className={cn("text-xs", adjustHint.tone === "error" ? "text-primary" : "text-muted-foreground")}>
                  {adjustHint.text}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>備考</Label>
              <Input
                placeholder="備考を入力..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="bg-secondary/50 border-border/50 h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            {modalType === "purchase" ? (
              <Button
                className="bg-primary hover:bg-primary/90"
                onClick={handleSubmit}
                disabled={submitting || !quantity}
              >
                {submitting ? "処理中..." : "確定"}
              </Button>
            ) : (
              <Button
                className="bg-primary hover:bg-primary/90"
                onClick={handleStageAdjust}
                disabled={adjustInvalid}
              >
                確定
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;
