import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Package, Plus, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Search, Filter, Package, Plus, Pencil, EyeOff } from "lucide-react";

interface Product {
  id: number;
  name: string;
  janCode: string;
  category: { displayName: string } | null;
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  sellingPrice: number;
  costPrice: number;
}

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
  const { toast } = useToast();

  const fetchProducts = useCallback(() => {
    setLoading(true);
    fetch("/api/inventory", { credentials: "include" })
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
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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

  const grossMargin = (p: Product) =>
    p.costPrice > 0 ? (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(1) : "—";

  const openModal = (p: Product, type: "purchase" | "adjust") => {
    setSelectedProduct(p);
    setModalType(type);
    setQuantity("");
    setNote("");
    setModalOpen(true);
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
        <div className="relative flex-1 min-w-[200px]">
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
      </motion.div>

      {/* テーブル */}
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
                <th className="text-left py-3 px-4 font-medium">部門</th>
                <th className="text-right py-3 px-4 font-medium">現在庫</th>
                <th className="text-right py-3 px-4 font-medium">発注点</th>
                <th className="text-right py-3 px-4 font-medium">適正在庫</th>
                <th className="text-right py-3 px-4 font-medium">売価</th>
                <th className="text-right py-3 px-4 font-medium">原価</th>
                <th className="text-right py-3 px-4 font-medium">粗利率</th>
                <th className="text-center py-3 px-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const status = getStockStatus(p);
                const cfg = statusConfig[status];
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
                    <td className="py-3 px-4 font-medium">{p.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="text-xs border-border/50">{getCategoryName(p)}</Badge>
                    </td>
                    <td className={cn("py-3 px-4 text-right font-num font-semibold", cfg.bg)}>{p.currentStock}</td>
                    <td className="py-3 px-4 text-right font-num text-muted-foreground">{p.reorderPoint}</td>
                    <td className="py-3 px-4 text-right font-num text-muted-foreground">{p.optimalStock}</td>
                    <td className="py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-num text-muted-foreground">¥{p.costPrice.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-num">{grossMargin(p)}%</td>
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
