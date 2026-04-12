import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Pencil, Trash2, Package, Link2, ChevronDown, ChevronUp } from "lucide-react";
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
  department: string;
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
  currentStock: number;
  reorderPoint: number;
  optimalStock: number;
  optimalStock01: number;
  optimalStock02: number;
  optimalStock03: number;
  optimalStock04: number;
  optimalStock05: number;
  optimalStock06: number;
  optimalStock07: number;
  optimalStock08: number;
  optimalStock09: number;
  optimalStock10: number;
  optimalStock11: number;
  optimalStock12: number;
  supplyType: string;
  salesType: string;
}

interface MonthlyOptimalStock {
  optimalStock: number;
  month: number;
  year: number;
}

interface SupplierMapping {
  id: number;
  supplierName: string;
  supplierProductName: string;
  productId: number;
  product: { id: number; name: string; janCode: string };
}

const supplyTypes = [
  { value: "SELF_MANUFACTURED", label: "自社製造" },
  { value: "PURCHASED", label: "仕入商品" },
  { value: "REPACK", label: "リパック" },
];

const salesTypes = [
  { value: "REGULAR", label: "通年販売" },
  { value: "SEASONAL", label: "季節限定" },
  { value: "WEATHER", label: "天候依存" },
  { value: "DISCONTINUED", label: "終売" },
];

const supplyLabel = (type: string) => supplyTypes.find((s) => s.value === type)?.label || type;
const salesTypeLabel = (type: string) => salesTypes.find((s) => s.value === type)?.label || type;
const salesTypeBadgeColor = (type: string) => {
  switch (type) {
    case "REGULAR": return "bg-green-500/15 text-green-400 border-green-500/30";
    case "SEASONAL": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "WEATHER": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "DISCONTINUED": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "";
  }
};

const monthLabels = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

const emptyForm = {
  janCode: "", name: "", categoryId: "", costPrice: "", sellingPrice: "",
  reorderPoint: "", optimalStock: "", supplyType: "PURCHASED", salesType: "REGULAR", color: "", size: "",
  optimalStock01: "", optimalStock02: "", optimalStock03: "", optimalStock04: "",
  optimalStock05: "", optimalStock06: "", optimalStock07: "", optimalStock08: "",
  optimalStock09: "", optimalStock10: "", optimalStock11: "", optimalStock12: "",
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkField, setBulkField] = useState<string>("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [mappings, setMappings] = useState<SupplierMapping[]>([]);
  const [mappingsOpen, setMappingsOpen] = useState(false);
  const [mappingSupplierFilter, setMappingSupplierFilter] = useState("ALL");
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [editingMappingProductId, setEditingMappingProductId] = useState<string>("");
  const [monthlyStocks, setMonthlyStocks] = useState<Record<number, number>>({});
  const { toast } = useToast();
  const scrollYRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);

  const fetchMonthlyStocks = useCallback(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    fetch(`/api/optimal-stock/month/${year}/${month}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.results) {
          const map: Record<number, number> = {};
          for (const r of data.results) {
            map[r.product.id] = r.optimalStock;
          }
          setMonthlyStocks(map);
        }
      })
      .catch(() => {});
  }, []);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    fetch("/api/products", { credentials: "include" })
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => toast({ title: "エラー", description: "商品データの取得に失敗しました", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  const fetchMappings = useCallback(() => {
    const query = mappingSupplierFilter !== "ALL" ? `?supplier=${mappingSupplierFilter}` : "";
    fetch(`/api/supplier-mappings${query}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setMappings)
      .catch(() => {});
  }, [mappingSupplierFilter]);

  useEffect(() => {
    fetchProducts();
    fetchMonthlyStocks();
    fetch("/api/products/categories", { credentials: "include" })
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => { });
  }, [fetchProducts, fetchMonthlyStocks]);

  useEffect(() => {
    if (mappingsOpen) fetchMappings();
  }, [mappingsOpen, fetchMappings]);

  useEffect(() => {
    if (shouldRestoreScrollRef.current) {
      window.scrollTo(0, scrollYRef.current);
      shouldRestoreScrollRef.current = false;
    }
  }, [products]);

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
      salesType: p.salesType || "REGULAR",
      color: p.color || "",
      size: p.size || "",
      optimalStock01: String(p.optimalStock01 || 0),
      optimalStock02: String(p.optimalStock02 || 0),
      optimalStock03: String(p.optimalStock03 || 0),
      optimalStock04: String(p.optimalStock04 || 0),
      optimalStock05: String(p.optimalStock05 || 0),
      optimalStock06: String(p.optimalStock06 || 0),
      optimalStock07: String(p.optimalStock07 || 0),
      optimalStock08: String(p.optimalStock08 || 0),
      optimalStock09: String(p.optimalStock09 || 0),
      optimalStock10: String(p.optimalStock10 || 0),
      optimalStock11: String(p.optimalStock11 || 0),
      optimalStock12: String(p.optimalStock12 || 0),
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

  const handleDelete = async (p: Product) => {
    if (!confirm(`「${p.name}」を削除しますか？\n（論理削除：在庫履歴は保持されます）`)) return;
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "削除完了", description: `${p.name} を削除しました` });
        scrollYRef.current = window.scrollY;
        shouldRestoreScrollRef.current = true;
        fetchProducts();
      } else {
        const data = await res.json();
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0 || !bulkField) return;
    setBulkSubmitting(true);
    try {
      const productIds = Array.from(selectedIds);

      if (bulkField === "currentStock") {
        const items = productIds.map((id) => ({ productId: id, newStock: parseInt(bulkValue) || 0 }));
        const res = await fetch("/api/products/bulk-stock", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items }),
        });
        const data = await res.json();
        if (res.ok) {
          toast({ title: "一括更新完了", description: `${data.updatedCount}件の在庫を更新しました` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
          return;
        }
      } else if (bulkField === "delete") {
        if (!confirm(`${selectedIds.size}件の商品を無効化しますか？\n（論理削除：在庫履歴は保持されます）`)) {
          setBulkSubmitting(false);
          return;
        }
        const res = await fetch("/api/products/bulk-update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ productIds, updates: { isActive: false } }),
        });
        const data = await res.json();
        if (res.ok) {
          toast({ title: "一括無効化完了", description: `${data.updatedCount}件を無効化しました` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
          return;
        }
      } else {
        const updates = { [bulkField]: bulkValue };
        const res = await fetch("/api/products/bulk-update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ productIds, updates }),
        });
        const data = await res.json();
        if (res.ok) {
          toast({ title: "一括更新完了", description: `${data.updatedCount}件を更新しました` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
          return;
        }
      }

      setBulkModalOpen(false);
      setBulkField("");
      setBulkValue("");
      setSelectedIds(new Set());
      scrollYRef.current = window.scrollY;
      shouldRestoreScrollRef.current = true;
      fetchProducts();
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleDeleteMapping = async (m: SupplierMapping) => {
    if (!confirm(`「${m.supplierName} / ${m.supplierProductName}」のマッピングを削除しますか？`)) return;
    try {
      const res = await fetch(`/api/supplier-mappings/${m.id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "削除完了", description: "マッピングを削除しました" });
        fetchMappings();
      } else {
        const data = await res.json();
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    }
  };

  const handleUpdateMapping = async (mappingId: number) => {
    if (!editingMappingProductId) return;
    try {
      const res = await fetch(`/api/supplier-mappings/${mappingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productId: parseInt(editingMappingProductId) }),
      });
      if (res.ok) {
        toast({ title: "更新完了", description: "紐づけ先を変更しました" });
        setEditingMappingId(null);
        setEditingMappingProductId("");
        fetchMappings();
      } else {
        const data = await res.json();
        toast({ title: "エラー", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    }
  };

  const handleSalesTypeChange = async (productId: number, newSalesType: string) => {
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ salesType: newSalesType }),
      });
      if (res.ok) {
        toast({ title: "更新完了", description: `販売タイプを${salesTypeLabel(newSalesType)}に変更しました` });
        scrollYRef.current = window.scrollY;
        shouldRestoreScrollRef.current = true;
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
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="outline" className="text-xs">{selectedIds.size}件選択中</Badge>
            <Button size="sm" variant="outline" className="gap-1 h-9" onClick={() => { setBulkField(""); setBulkValue(""); setBulkModalOpen(true); }}>
              <Pencil className="w-3.5 h-3.5" /> 一括編集
            </Button>
            <Button size="sm" variant="outline" className="gap-1 h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => { setBulkField("delete"); handleBulkUpdate(); }}>
              <Trash2 className="w-3.5 h-3.5" /> 一括無効化
            </Button>
            <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setSelectedIds(new Set())}>
              選択解除
            </Button>
          </div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="w-10 py-3 px-2 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 cursor-pointer accent-[hsl(var(--primary))]"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="text-left py-3 px-4 font-medium">JAN</th>
                <th className="text-left py-3 px-4 font-medium">商品名</th>
                <th className="text-left py-3 px-4 font-medium">部門</th>
                <th className="text-left py-3 px-4 font-medium">販売タイプ</th>
                <th className="text-right py-3 px-4 font-medium">原価</th>
                <th className="text-right py-3 px-4 font-medium">売価</th>
                <th className="text-right py-3 px-4 font-medium">現在庫</th>
                <th className="text-right py-3 px-4 font-medium">適正在庫</th>
                <th className="text-center py-3 px-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-2 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 cursor-pointer accent-[hsl(var(--primary))]"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="py-3 px-4 font-num text-xs text-muted-foreground">{p.janCode}</td>
                  <td className="py-3 px-4 font-medium">{p.name}</td>
                  <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{p.category.displayName}</Badge></td>
                  <td className="py-3 px-4">
                    <Select value={p.salesType || "REGULAR"} onValueChange={(v) => handleSalesTypeChange(p.id, v)}>
                      <SelectTrigger className={`h-7 w-24 text-[11px] border ${salesTypeBadgeColor(p.salesType || "REGULAR")}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {salesTypes.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-3 px-4 text-right font-num">¥{p.costPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">¥{p.sellingPrice.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-num">{p.currentStock}</td>
                  <td className="py-3 px-4 text-right font-num">
                    {(() => {
                      const monthlyVal = monthlyStocks[p.id];
                      const isUnderstocked = monthlyVal !== undefined && p.currentStock < monthlyVal;
                      const val = monthlyVal !== undefined ? monthlyVal : p.optimalStock;
                      return (
                        <span className={isUnderstocked ? "text-red-400 font-semibold" : ""}>
                          {val}
                          {isUnderstocked && <span className="text-[10px] ml-1">不足</span>}
                        </span>
                      );
                    })()}
                  </td>
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
                  <td colSpan={11} className="py-12 text-center text-muted-foreground">
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
              <Label>販売タイプ</Label>
              <Select value={form.salesType} onValueChange={(v) => updateField("salesType", v)}>
                <SelectTrigger className="bg-secondary/50 border-border/50 h-10"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  {salesTypes.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
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
            {categories.find((c) => String(c.id) === form.categoryId)?.department !== "APPAREL" && (
              <div className="space-y-2">
                <Label>適正在庫</Label>
                <Input type="number" value={form.optimalStock} onChange={(e) => updateField("optimalStock", e.target.value)}
                  className="bg-secondary/50 border-border/50 h-10" />
              </div>
            )}
            {categories.find((c) => String(c.id) === form.categoryId)?.department === "APPAREL" && (
              <div className="col-span-2 space-y-2">
                <Label>月別適正在庫</Label>
                <div className="grid grid-cols-4 gap-2">
                  {monthLabels.map((label, i) => {
                    const field = `optimalStock${String(i + 1).padStart(2, "0")}` as keyof typeof form;
                    return (
                      <div key={field} className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">{label}</span>
                        <Input type="number" value={form[field]} onChange={(e) => updateField(field, e.target.value)}
                          className="bg-secondary/50 border-border/50 h-8 text-xs" />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">※ 全て0の場合は従来の適正在庫値を使用します</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={handleSave} disabled={submitting}>
              {submitting ? "処理中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一括編集モーダル */}
      <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
        <DialogContent className="bg-card border-border/50 max-w-md">
          <DialogHeader><DialogTitle>{selectedIds.size}件の商品を一括編集</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>変更する項目</Label>
              <Select value={bulkField} onValueChange={(v) => { setBulkField(v); setBulkValue(""); }}>
                <SelectTrigger className="bg-secondary/50 border-border/50 h-10">
                  <SelectValue placeholder="項目を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="categoryId">部門</SelectItem>
                  <SelectItem value="costPrice">原価</SelectItem>
                  <SelectItem value="sellingPrice">売価</SelectItem>
                  <SelectItem value="reorderPoint">発注点</SelectItem>
                  <SelectItem value="optimalStock">適正在庫</SelectItem>
                  <SelectItem value="supplyType">供給タイプ</SelectItem>
                  <SelectItem value="currentStock">在庫数</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bulkField && (
              <div className="space-y-2">
                <Label>
                  {bulkField === "categoryId" ? "部門" :
                   bulkField === "costPrice" ? "原価(円)" :
                   bulkField === "sellingPrice" ? "売価(円)" :
                   bulkField === "reorderPoint" ? "発注点" :
                   bulkField === "optimalStock" ? "適正在庫" :
                   bulkField === "supplyType" ? "供給タイプ" :
                   bulkField === "currentStock" ? "在庫数" : "値"}
                </Label>
                {bulkField === "categoryId" ? (
                  <Select value={bulkValue} onValueChange={setBulkValue}>
                    <SelectTrigger className="bg-secondary/50 border-border/50 h-10">
                      <SelectValue placeholder="部門を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : bulkField === "supplyType" ? (
                  <Select value={bulkValue} onValueChange={setBulkValue}>
                    <SelectTrigger className="bg-secondary/50 border-border/50 h-10">
                      <SelectValue placeholder="タイプを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {supplyTypes.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="値を入力"
                    className="bg-secondary/50 border-border/50 h-10"
                  />
                )}
                {bulkField === "currentStock" && (
                  <p className="text-[10px] text-muted-foreground">
                    ※ 選択した全商品の在庫数がこの値に設定されます。在庫調整として記録されます。
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkModalOpen(false)}>キャンセル</Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleBulkUpdate}
              disabled={bulkSubmitting || !bulkField || (!bulkValue && bulkField !== "currentStock")}
            >
              {bulkSubmitting ? "処理中..." : `${selectedIds.size}件を更新`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 仕入先マッピング管理 */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/30 transition-colors"
          onClick={() => setMappingsOpen(!mappingsOpen)}
        >
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">仕入先マッピング管理</span>
            {mappings.length > 0 && <Badge variant="outline" className="text-xs ml-1">{mappings.length}件</Badge>}
          </div>
          {mappingsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {mappingsOpen && (
          <div className="border-t border-border/50">
            <div className="px-5 py-3 flex items-center gap-3 border-b border-border/30">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">仕入先</Label>
              <Select value={mappingSupplierFilter} onValueChange={setMappingSupplierFilter}>
                <SelectTrigger className="bg-secondary/50 border-border/50 h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">すべて</SelectItem>
                  <SelectItem value="ETOILE">ETOILE</SelectItem>
                  <SelectItem value="COREC">COREC</SelectItem>
                  <SelectItem value="JANNU">JANNU</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left py-2.5 px-4 font-medium text-xs">仕入先</th>
                    <th className="text-left py-2.5 px-4 font-medium text-xs">仕入先商品名</th>
                    <th className="text-left py-2.5 px-4 font-medium text-xs">紐づけ先商品</th>
                    <th className="text-center py-2.5 px-4 font-medium text-xs w-32">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                      <td className="py-2.5 px-4">
                        <Badge variant="outline" className="text-xs">{m.supplierName}</Badge>
                      </td>
                      <td className="py-2.5 px-4 text-xs">{m.supplierProductName}</td>
                      <td className="py-2.5 px-4">
                        {editingMappingId === m.id ? (
                          <Select value={editingMappingProductId} onValueChange={setEditingMappingProductId}>
                            <SelectTrigger className="bg-secondary/50 border-border/50 h-8 text-xs">
                              <SelectValue placeholder="商品を選択" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs font-medium">{m.product.name}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex justify-center gap-1">
                          {editingMappingId === m.id ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => handleUpdateMapping(m.id)}>
                                保存
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditingMappingId(null); setEditingMappingProductId(""); }}>
                                取消
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingMappingId(m.id); setEditingMappingProductId(String(m.productId)); }}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteMapping(m)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {mappings.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted-foreground text-xs">
                        マッピングが登録されていません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default ProductSettings;
