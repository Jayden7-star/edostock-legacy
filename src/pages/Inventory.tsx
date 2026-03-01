import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Package, Plus, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Product {
  id: number;
  name: string;
  janCode: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  sellingPrice: number;
  costPrice: number;
}

const mockProducts: Product[] = [
  { id: 1, name: "江戸一昆布", janCode: "4970974100005", category: "佃煮（自社）", currentStock: 0, reorderPoint: 10, optimalStock: 30, sellingPrice: 495, costPrice: 200 },
  { id: 2, name: "一口ほたて(大)", janCode: "4970974101262", category: "佃煮（自社）", currentStock: 2, reorderPoint: 8, optimalStock: 20, sellingPrice: 893, costPrice: 450 },
  { id: 3, name: "しそ巻き", janCode: "4970974200001", category: "佃煮（仕入）", currentStock: 3, reorderPoint: 5, optimalStock: 15, sellingPrice: 650, costPrice: 380 },
  { id: 4, name: "ちりめん山椒", janCode: "4970974300002", category: "佃煮（リパック）", currentStock: 5, reorderPoint: 7, optimalStock: 20, sellingPrice: 750, costPrice: 400 },
  { id: 5, name: "黒豆", janCode: "4970974400003", category: "煮豆", currentStock: 4, reorderPoint: 5, optimalStock: 12, sellingPrice: 540, costPrice: 280 },
  { id: 6, name: "タオル 桜富士", janCode: "4970974502274", category: "雑貨", currentStock: 82, reorderPoint: 20, optimalStock: 100, sellingPrice: 990, costPrice: 400 },
  { id: 7, name: "五目まぜご飯の素", janCode: "4970974600001", category: "混ぜご飯の素", currentStock: 15, reorderPoint: 5, optimalStock: 20, sellingPrice: 480, costPrice: 220 },
  { id: 8, name: "ジップパーカー ブラウン XL", janCode: "4970974503516", category: "Tシャツ", currentStock: 8, reorderPoint: 2, optimalStock: 6, sellingPrice: 7000, costPrice: 3500 },
  { id: 9, name: "特売 1200", janCode: "4970974503684", category: "特売", currentStock: 25, reorderPoint: 10, optimalStock: 40, sellingPrice: 1200, costPrice: 600 },
  { id: 10, name: "ばかうけ", janCode: "4970974700002", category: "菓子", currentStock: 12, reorderPoint: 5, optimalStock: 15, sellingPrice: 320, costPrice: 180 },
];

const categories = ["すべて", "佃煮（自社）", "佃煮（仕入）", "佃煮（リパック）", "煮豆", "菓子", "混ぜご飯の素", "雑貨", "Tシャツ", "特売"];
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

const Inventory = () => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("すべて");
  const [stockFilter, setStockFilter] = useState("すべて");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"purchase" | "adjust">("purchase");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const filtered = mockProducts.filter((p) => {
    const matchSearch = p.name.includes(search) || p.janCode.includes(search);
    const matchCat = category === "すべて" || p.category === category;
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
                      <Badge variant="outline" className="text-xs border-border/50">{p.category}</Badge>
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
                          onClick={() => { setSelectedProduct(p); setModalType("purchase"); setModalOpen(true); }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => { setSelectedProduct(p); setModalType("adjust"); setModalOpen(true); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
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
              <Input type="number" placeholder="0" className="bg-secondary/50 border-border/50 h-11" />
            </div>
            <div className="space-y-2">
              <Label>備考</Label>
              <Input placeholder="備考を入力..." className="bg-secondary/50 border-border/50 h-11" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={() => setModalOpen(false)}>
              確定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;
