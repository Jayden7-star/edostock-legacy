import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Pencil, Trash2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Category {
  id: number;
  name: string;
  displayName: string;
}

interface Product {
  id: number;
  janCode: string;
  name: string;
  color: string | null;
  size: string | null;
  category: Category;
  categoryId: number;
  costPrice: number;
  sellingPrice: number;
  reorderPoint: number;
  optimalStock: number;
  supplyType: string;
}

const supplyTypes = [
  { value: "SELF_MANUFACTURED", label: "自社製造" },
  { value: "PURCHASED", label: "仕入商品" },
  { value: "REPACK", label: "リパック" },
];

const supplyLabel = (type: string) => supplyTypes.find((s) => s.value === type)?.label || type;

const emptyForm = {
  janCode: "", name: "", categoryId: "", costPrice: "", sellingPrice: "",
  reorderPoint: "", optimalStock: "", supplyType: "PURCHASED", color: "", size: "",
};

const ProductSettings = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const fetchProducts = useCallback(() => {
    setLoading(true);
    fetch("/api/products", { credentials: "include" })
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => toast({ title: "エラー", description: "商品データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchProducts();
    fetch("/api/products/categories", { credentials: "include" })
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => { });
  }, [fetchProducts]);

  const filtered = products.filter(
    (p) => p.name.includes(search) || p.janCode.includes(search)
  );

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm({
      janCode: p.janCode,
      name: p.name,
      categoryId: String(p.categoryId),
      costPrice: String(p.costPrice),
      sellingPrice: String(p.sellingPrice),
      reorderPoint: String(p.reorderPoint),
      optimalStock: String(p.optimalStock),
      supplyType: p.supplyType,
      color: p.color || "",
      size: p.size || "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.janCode || !form.name || !form.categoryId) {
      toast({ title: "入力エラー", description: "商品コード、商品名、部門は必須です", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const url = editingId ? `/api/products/${editingId}` : "/api/products";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: editingId ? "更新完了" : "登録完了", description: `${form.name} を${editingId ? "更新" : "登録"}しました` });
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

  const handleDelete = async (p: Product) => {
    if (!confirm(`「${p.name}」を削除しますか？\n（論理削除：在庫履歴は保持されます）`)) return;
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "削除完了", description: `${p.name} を削除しました` });
        fetchProducts();
      } else {
        const data = await res.json();
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    }
  };

  const updateField = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-16 shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="商品名・JANで検索..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/50 border-border/50 h-10" />
        </div>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={openAdd}>
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
                  <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{p.category.displayName}</Badge></td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{supplyLabel(p.supplyType)}</td>
                  <td className="py-3 px-4 text-right font-num">¥{p.costPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">{p.reorderPoint}</td>
                  <td className="py-3 px-4 text-right font-num">{p.optimalStock}</td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-1">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(p)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>商品が登録されていません</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* 商品追加/編集モーダル */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border/50 max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "商品を編集" : "商品を追加"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label>商品コード(JAN)</Label>
              <Input value={form.janCode} onChange={(e) => updateField("janCode", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" disabled={!!editingId} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>商品名</Label>
              <Input value={form.name} onChange={(e) => updateField("name", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-2">
              <Label>部門</Label>
              <Select value={form.categoryId} onValueChange={(v) => updateField("categoryId", v)}>
                <SelectTrigger className="bg-secondary/50 border-border/50 h-10"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>供給タイプ</Label>
              <Select value={form.supplyType} onValueChange={(v) => updateField("supplyType", v)}>
                <SelectTrigger className="bg-secondary/50 border-border/50 h-10"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  {supplyTypes.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>原価(円)</Label>
              <Input type="number" value={form.costPrice} onChange={(e) => updateField("costPrice", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-2">
              <Label>売価(円)</Label>
              <Input type="number" value={form.sellingPrice} onChange={(e) => updateField("sellingPrice", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-2">
              <Label>発注点</Label>
              <Input type="number" value={form.reorderPoint} onChange={(e) => updateField("reorderPoint", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-2">
              <Label>適正在庫</Label>
              <Input type="number" value={form.optimalStock} onChange={(e) => updateField("optimalStock", e.target.value)}
                className="bg-secondary/50 border-border/50 h-10" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={handleSave} disabled={submitting}>
              {submitting ? "処理中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductSettings;
