import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const categories = ["佃煮（自社）", "佃煮（仕入）", "佃煮（リパック）", "煮豆", "菓子", "混ぜご飯の素", "雑貨", "Tシャツ", "特売", "その他（仕入）"];

const mockProducts = [
  { id: 1, janCode: "4970974100005", name: "江戸一昆布", category: "佃煮（自社）", costPrice: 200, sellingPrice: 495, reorderPoint: 10, optimalStock: 30, supplyType: "自社製造" },
  { id: 2, janCode: "4970974101262", name: "一口ほたて(大)", category: "佃煮（自社）", costPrice: 450, sellingPrice: 893, reorderPoint: 8, optimalStock: 20, supplyType: "自社製造" },
  { id: 3, janCode: "4970974200001", name: "しそ巻き", category: "佃煮（仕入）", costPrice: 380, sellingPrice: 650, reorderPoint: 5, optimalStock: 15, supplyType: "仕入商品" },
  { id: 4, janCode: "4970974300002", name: "ちりめん山椒", category: "佃煮（リパック）", costPrice: 400, sellingPrice: 750, reorderPoint: 7, optimalStock: 20, supplyType: "リパック" },
  { id: 5, janCode: "4970974400003", name: "黒豆", category: "煮豆", costPrice: 280, sellingPrice: 540, reorderPoint: 5, optimalStock: 12, supplyType: "仕入商品" },
  { id: 6, janCode: "4970974502274", name: "タオル 桜富士", category: "雑貨", costPrice: 400, sellingPrice: 990, reorderPoint: 20, optimalStock: 100, supplyType: "仕入商品" },
];

const ProductSettings = () => {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = mockProducts.filter(
    (p) => p.name.includes(search) || p.janCode.includes(search)
  );

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="商品名・JANで検索..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/50 border-border/50 h-10" />
        </div>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4" /> 商品追加
        </Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left py-3 px-4 font-medium">JAN</th>
                <th className="text-left py-3 px-4 font-medium">商品名</th>
                <th className="text-left py-3 px-4 font-medium">部門</th>
                <th className="text-left py-3 px-4 font-medium">供給</th>
                <th className="text-right py-3 px-4 font-medium">原価</th>
                <th className="text-right py-3 px-4 font-medium">売価</th>
                <th className="text-right py-3 px-4 font-medium">発注点</th>
                <th className="text-right py-3 px-4 font-medium">適正在庫</th>
                <th className="text-center py-3 px-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4 font-num text-xs text-muted-foreground">{p.janCode}</td>
                  <td className="py-3 px-4 font-medium">{p.name}</td>
                  <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{p.category}</Badge></td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{p.supplyType}</td>
                  <td className="py-3 px-4 text-right font-num">¥{p.costPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">{p.reorderPoint}</td>
                  <td className="py-3 px-4 text-right font-num">{p.optimalStock}</td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-1">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* 商品追加モーダル */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border/50 max-w-lg">
          <DialogHeader><DialogTitle>商品を追加</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2"><Label>商品コード(JAN)</Label><Input className="bg-secondary/50 border-border/50 h-10" /></div>
            <div className="col-span-2 space-y-2"><Label>商品名</Label><Input className="bg-secondary/50 border-border/50 h-10" /></div>
            <div className="space-y-2">
              <Label>部門</Label>
              <Select><SelectTrigger className="bg-secondary/50 border-border/50 h-10"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>供給タイプ</Label>
              <Select><SelectTrigger className="bg-secondary/50 border-border/50 h-10"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent><SelectItem value="self">自社製造</SelectItem><SelectItem value="purchase">仕入商品</SelectItem><SelectItem value="repack">リパック</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>原価(円)</Label><Input type="number" className="bg-secondary/50 border-border/50 h-10" /></div>
            <div className="space-y-2"><Label>売価(円)</Label><Input type="number" className="bg-secondary/50 border-border/50 h-10" /></div>
            <div className="space-y-2"><Label>発注点</Label><Input type="number" className="bg-secondary/50 border-border/50 h-10" /></div>
            <div className="space-y-2"><Label>適正在庫</Label><Input type="number" className="bg-secondary/50 border-border/50 h-10" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={() => setModalOpen(false)}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductSettings;
