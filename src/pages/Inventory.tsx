import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Package, Plus, Pencil, EyeOff, List, LayoutGrid, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
}

type ViewMode = "list" | "grid";

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
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"purchase" | "adjust">("purchase");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ViewMode) || "list";
  });
  const { toast } = useToast();
  const scrollYRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const [searchParams] = useSearchParams();
  const department = searchParams.get("department") || "";

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const url = department ? `/api/inventory?department=${department}` : "/api/inventory";
    fetch(url, { credentials: "include" })
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
  }, [department, toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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

  const toggleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  const grossMargin = (p: Product) =>
    p.costPrice > 0 ? (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(1) : "—";

  const openModal = (p: Product, type: "purchase" | "adjust") => {
    setSelectedProduct(p);
    setModalType(type);
    setQuantity("");
    setNote("");
    setModalOpen(true);
  };

  const handleDeactivate = async (p: Product) => {
    if (!confirm(`「${p.name}」を終売にして一覧から非表示にしますか？\n（売上分析データは保持されます）`)) return;
    const savedScrollY = window.scrollY;
    try {
      await fetch(`/api/inventory/${p.id}/deactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      setProducts((prev) => prev.filter((item) => item.id !== p.id));
      toast({ title: "終売設定完了", description: `${p.name}を非表示にしました` });
    } catch {
      toast({ title: "エラー", description: "処理に失敗しました", variant: "destructive" });
    } finally {
      requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
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
    <div className="space-y-5">
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
                  return (
                    <motion.tr
                      key={p.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border/30 hover:bg-secondary/30 transition-colors"
                    >
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
                      </td>
                      <td className="hidden md:table-cell py-3 px-4">
                        <Badge variant="outline" className="text-xs border-border/50">{getCategoryName(p)}</Badge>
                      </td>
                      <td className={cn("py-3 px-4 text-right font-num font-semibold", cfg.bg)}>{p.currentStock}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">{p.reorderPoint}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">{p.optimalStock}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num text-muted-foreground">¥{p.costPrice.toLocaleString()}</td>
                      <td className="hidden md:table-cell py-3 px-4 text-right font-num">{grossMargin(p)}%</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-edo-success hover:text-edo-success hover:bg-edo-success/10"
                            onClick={() => openModal(p, "purchase")}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openModal(p, "adjust")}
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
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground">
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
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={cn(
                      "glass-card-hover p-4 flex flex-col gap-3",
                      isLowStock && "border-edo-warning/50"
                    )}
                  >
                    {/* ヘッダー: 商品名 + ステータス */}
                    <div className="flex items-start justify-between gap-2">
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
                      <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", cfg.dot)} title={cfg.label} />
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

                    {/* 売価 */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">売価</span>
                      <span className="font-num font-semibold">¥{p.sellingPrice.toLocaleString()}</span>
                    </div>

                    {/* 操作ボタン */}
                    <div className="flex items-center justify-end gap-1 mt-auto pt-2 border-t border-border/30">
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
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
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
                className="bg-secondary/50 border-border/50 h-11"
              />
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
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleSubmit}
              disabled={submitting || !quantity}
            >
              {submitting ? "処理中..." : "確定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;
