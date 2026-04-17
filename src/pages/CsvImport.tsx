import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, CheckCircle, AlertTriangle, ArrowRight, ArrowLeft, X, ShoppingCart, BarChart3, Plus, Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import Papa from "papaparse";

const steps = ["アップロード", "在庫プレビュー", "確認・確定", "完了"];

interface ParsedRow {
  janCode: string;
  category: string;
  name: string;
  qty: number;
  sales: number;
  isNew: boolean;
  raw: Record<string, string>;
}

interface HistoryItem {
  id: number;
  filename: string;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
  importedAt: string;
  csvType: string;
  user?: { name: string };
}

interface ImportResult {
  recordCount: number;
  newCount: number;
  autoCreatedCount?: number;
}

interface StockPreviewMatched {
  productName: string;
  currentStock: number | null;
  soldQty: number;
  afterStock: number | null;
}

interface StockPreviewUnmatched {
  janCode: string;
  productName: string;
  soldQty: number;
  candidates: { id: number; janCode: string; name: string }[];
  willAutoRegister?: boolean;
}

interface StockPreviewData {
  matched: StockPreviewMatched[];
  unmatched: StockPreviewUnmatched[];
}

// 未マッチ商品の手動マッチング選択状態
// key: csvJanCode, value: { mode, existingProductId }
interface UnmatchedSelection {
  mode: "new" | "existing";
  existingProductId: number | null;
}

// === 仕入インポート用 ===
interface PurchaseMatchResult {
  row: number;
  status: "matched" | "unmatched";
  itemCode: string;
  janCode: string;
  csvName: string;
  color: string;
  size: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
  matchedProduct: string | null;
  matchedId: number | null;
}

interface PurchaseSummary {
  total: number;
  matched: number;
  unmatched: number;
  totalQuantity: number;
  totalCost: number;
}

interface CorecItem {
  row: number;
  hinban: string;
  productName: string;
  janCode: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  matched: boolean;
  matchedProductId: number | null;
  matchedProductName: string | null;
  currentStock: number | null;
}

interface JannuItem {
  row: number;
  design: string;
  modelCode: string;
  color: string;
  size: string;
  quantity: number;
  supplierProductName: string;
  matched: boolean;
  matchedProductId: number | null;
  matchedProductName: string | null;
  currentStock: number | null;
}

const suppliers = [
  { value: "etoile", label: "エトワール海渡", accept: ".csv", dropText: "エトワール海渡のCSVファイルをドラッグ＆ドロップ" },
  { value: "corec", label: "コレック", accept: ".pdf", dropText: "コレックの発注書PDFをドラッグ＆ドロップ" },
  { value: "jannu", label: "ジャヌツー", accept: ".xlsx,.xls", dropText: "ジャヌツーの発注Excelファイルをドラッグ＆ドロップ" },
];

function ProductCombobox({
  products,
  value,
  onSelect,
  placeholder = "商品を検索...",
}: {
  products: { id: number; name: string }[];
  value: number | null;
  onSelect: (productId: number | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedProduct = value ? products.find((p) => p.id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-between h-7 w-56 rounded-md border border-border/50 bg-secondary/50 px-2 text-xs",
            !selectedProduct && "text-muted-foreground"
          )}
        >
          <span className="truncate">
            {selectedProduct ? selectedProduct.name : "どの商品に対応しますか？"}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-8 text-xs" />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">
              商品が見つかりません
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                  className="text-xs text-edo-info"
                >
                  ✚ 新規登録に戻す
                </CommandItem>
              )}
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onSelect(p.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-1 h-3 w-3",
                      value === p.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const CsvImport = () => {
  const [activeTab, setActiveTab] = useState("sales");
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary/50 mb-4">
            <TabsTrigger value="sales" className="gap-2">
              <BarChart3 className="w-3.5 h-3.5" /> 売上データ
            </TabsTrigger>
            <TabsTrigger value="purchase" className="gap-2">
              <ShoppingCart className="w-3.5 h-3.5" /> 仕入データ
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sales">
            <SalesImportTab toast={toast} />
          </TabsContent>
          <TabsContent value="purchase">
            <PurchaseImportTab toast={toast} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
};

// ========================
// 売上データタブ（既存ロジック）
// ========================
const SalesImportTab = ({ toast }: { toast: any }) => {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [rawRecords, setRawRecords] = useState<Record<string, string>[]>([]);
  const [csvType, setCsvType] = useState<"PRODUCT_SALES" | "MONTHLY_SALES">("PRODUCT_SALES");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dupWarning, setDupWarning] = useState<HistoryItem | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<StockPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [unmatchedSelections, setUnmatchedSelections] = useState<Map<string, UnmatchedSelection>>(new Map());
  const [allProducts, setAllProducts] = useState<{ id: number; janCode: string; name: string }[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // 全商品リストの取得（マッチングコンボボックス用）
  useEffect(() => {
    fetch("/api/products", { credentials: "include" })
      .then((r) => r.json())
      .then((data: any[]) => setAllProducts(data.map((p) => ({ id: p.id, janCode: p.janCode, name: p.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 1 || rawRecords.length === 0) return;
    setPreviewLoading(true);
    fetch("/api/csv/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ records: rawRecords }),
    })
      .then((r) => r.json())
      .then((data) => {
        setPreviewData(data);
        // 未マッチ商品の初期選択状態を設定
        const selections = new Map<string, UnmatchedSelection>();
        for (const u of data.unmatched || []) {
          selections.set(u.janCode, { mode: "new", existingProductId: null });
        }
        setUnmatchedSelections(selections);
      })
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, [step]);

  useEffect(() => {
    fetch("/api/csv/history", { credentials: "include" })
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => { });
  }, [step]);

  const detectCsvType = (headers: string[]): "PRODUCT_SALES" | "MONTHLY_SALES" => {
    if (headers.includes("商品コード") || headers.includes("商品名")) return "PRODUCT_SALES";
    if (headers.includes("日付") || headers.includes("純売上")) return "MONTHLY_SALES";
    return "PRODUCT_SALES";
  };

  const extractPeriodFromFilename = (name: string) => {
    const match = name.match(/(\d{8})-(\d{8})/);
    if (match) {
      const s = match[1];
      const e = match[2];
      return {
        start: `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`,
        end: `${e.slice(0, 4)}/${e.slice(4, 6)}/${e.slice(6, 8)}`,
      };
    }
    const monthMatch = name.match(/(\d{6})/);
    if (monthMatch) {
      const m = monthMatch[1];
      return {
        start: `${m.slice(0, 4)}/${m.slice(4, 6)}/01`,
        end: `${m.slice(0, 4)}/${m.slice(4, 6)}/28`,
      };
    }
    const today = new Date();
    return {
      start: `${today.getFullYear()}/01/01`,
      end: `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`,
    };
  };

  const parseFile = (f: File) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const records = result.data as Record<string, string>[];
        const headers = result.meta.fields || [];
        const type = detectCsvType(headers);
        setCsvType(type);
        setRawRecords(records);

        // ← ここを修正

          if (type === "PRODUCT_SALES") {
  // 商品コードごとに集計
  const aggregated: Record<string, { category: string; name: string; qty: number; sales: number; raw: Record<string, string> }> = {};
  
  records
    .filter((r) => r["商品コード"]?.trim() && r["商品コード"]?.trim() !== "合計")
    .forEach((r) => {
      const code = r["商品コード"].trim();
      if (!aggregated[code]) {
        aggregated[code] = {
          category: r["部門名"]?.trim() || "",
          name: r["商品名"]?.trim() || "",
          qty: 0,
          sales: 0,
          raw: r,
        };
      }
      aggregated[code].qty += parseInt(r["数量"]) || 0;
      aggregated[code].sales += parseInt(r["値引き後計"]) || 0;
    });

  const rows: ParsedRow[] = Object.entries(aggregated).map(([janCode, v]) => ({
    janCode,
    category: v.category,
    name: v.name,
    qty: v.qty,
    sales: v.sales,
    isNew: false,
    raw: v.raw,
  }));
  setParsedRows(rows);
}

          const period = extractPeriodFromFilename(f.name);
          setPeriodStart(period.start);
          setPeriodEnd(period.end);
          setStep(1);
        },
      });
    };
    reader.readAsText(f, "Shift_JIS");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) {
      setFile(f);
      parseFile(f);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      parseFile(f);
    }
  };

  // === 二重インポート防止 ===
  const checkDupThenParse = async (f: File) => {
    setFile(f);
    try {
      const res = await fetch("/api/csv/history", { credentials: "include" });
      const hist: HistoryItem[] = await res.json();
      const found = hist.find((h) => h.filename === f.name);
      if (found) {
        setPendingFile(f);
        setDupWarning(found);
      } else {
        parseFile(f);
      }
    } catch {
      parseFile(f);
    }
  };

  const handleDropWithDupCheck = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) {
      checkDupThenParse(f);
    }
  };

  const handleFileSelectWithDupCheck = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) checkDupThenParse(f);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      // matchOverridesを構築
      const matchOverrides: { csvJanCode: string; csvProductName: string; existingProductId: number }[] = [];
      for (const [janCode, sel] of unmatchedSelections.entries()) {
        if (sel.mode === "existing" && sel.existingProductId) {
          const unmatchedItem = previewData?.unmatched.find((u) => u.janCode === janCode);
          matchOverrides.push({
            csvJanCode: janCode,
            csvProductName: unmatchedItem?.productName || "",
            existingProductId: sel.existingProductId,
          });
        }
      }

      const res = await fetch("/api/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          records: rawRecords,
          csvType,
          filename: file?.name || "import.csv",
          periodStart: new Date(periodStart.replace(/\//g, "-")).toISOString(),
          periodEnd: new Date(periodEnd.replace(/\//g, "-")).toISOString(),
          matchOverrides: matchOverrides.length > 0 ? matchOverrides : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult({ recordCount: data.recordCount, newCount: 0, autoCreatedCount: data.autoCreatedCount || 0 });
        setStep(3);
        toast({ title: "インポート完了", description: `${data.recordCount}件のデータを取り込みました` });
      } else {
        toast({ title: "エラー", description: data.error || "インポートに失敗しました", variant: "destructive" });
      }
    } catch {
      toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ステップインジケーター */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4">
        <div className="flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-num font-semibold transition-colors",
                i <= step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}>
                {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={cn("text-sm hidden sm:inline", i <= step ? "text-foreground" : "text-muted-foreground")}>{s}</span>
              {i < steps.length - 1 && <div className={cn("w-12 h-0.5 mx-2", i < step ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="upload" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDropWithDupCheck}
              className={cn(
                "glass-card border-2 border-dashed p-16 text-center transition-all cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/30"
              )}
              onClick={() => document.getElementById("csv-input")?.click()}
            >
              <Upload className={cn("w-12 h-12 mx-auto mb-4 transition-colors", dragOver ? "text-primary" : "text-muted-foreground")} />
              <p className="text-lg font-medium mb-2">CSVファイルをドラッグ＆ドロップ</p>
              <p className="text-sm text-muted-foreground mb-4">またはクリックしてファイルを選択</p>
              <p className="text-xs text-muted-foreground">対応形式: スマレジ 商品別売上CSV / 月別売上CSV</p>
              <input id="csv-input" type="file" accept=".csv" className="hidden" onChange={handleFileSelectWithDupCheck} />
            </div>
            {dupWarning && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 glass-card p-4 border border-amber-400/30 bg-amber-400/5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-400">⚠️ このファイルは過去にインポート済みです</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      インポート日時: {new Date(dupWarning.importedAt).toLocaleString("ja-JP")}
                      {dupWarning.user && ` / ユーザー: ${dupWarning.user.name}`}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => { setDupWarning(null); setPendingFile(null); setFile(null); }}>
                    キャンセル
                  </Button>
                  <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => { const f = pendingFile; setDupWarning(null); setPendingFile(null); if (f) parseFile(f); }}>
                    続けてインポート
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="stock-preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <BarChart3 className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold">在庫変動プレビュー</h3>
              </div>
              {previewLoading ? (
                <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full" />
                  在庫情報を取得中...
                </div>
              ) : previewData ? (
                <div className="space-y-4">
                  {previewData.unmatched.length > 0 && (
                    <div className="border border-amber-400/30 bg-amber-400/5 rounded-lg p-4">
                      <div className="flex items-start gap-2 mb-3">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-sm font-semibold text-amber-400">未マッチ商品 {previewData.unmatched.length}件（既存商品を選択するか、新規登録されます）</p>
                      </div>
                      <div className="space-y-3">
                        {previewData.unmatched.map((u) => {
                          const sel = unmatchedSelections.get(u.janCode) || { mode: "new" as const, existingProductId: null };
                          return (
                            <div key={u.janCode} className="border border-border/30 rounded-lg p-3 bg-background/50">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-num text-muted-foreground">{u.janCode}</p>
                                  <p className="text-sm font-medium truncate">{u.productName}</p>
                                </div>
                                <span className="text-xs font-num ml-3 whitespace-nowrap">売上: {u.soldQty}点</span>
                              </div>
                              <div className="flex flex-col gap-2 mt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`match-${u.janCode}`}
                                    checked={sel.mode === "existing"}
                                    onChange={() => {
                                      const next = new Map(unmatchedSelections);
                                      next.set(u.janCode, { mode: "existing", existingProductId: sel.existingProductId });
                                      setUnmatchedSelections(next);
                                    }}
                                    className="w-3.5 h-3.5"
                                  />
                                  <span className="text-xs">既存商品に統合（JAN・名前を更新）</span>
                                </label>
                                {sel.mode === "existing" && (
                                  <div className="ml-6">
                                    <ProductCombobox
                                      products={allProducts}
                                      value={sel.existingProductId}
                                      onSelect={(productId) => {
                                        const next = new Map(unmatchedSelections);
                                        next.set(u.janCode, { mode: "existing", existingProductId: productId });
                                        setUnmatchedSelections(next);
                                      }}
                                      placeholder="既存商品を検索..."
                                    />
                                    {u.candidates.length > 0 && !sel.existingProductId && (
                                      <div className="mt-1.5">
                                        <p className="text-[10px] text-muted-foreground mb-1">候補:</p>
                                        <div className="flex flex-wrap gap-1">
                                          {u.candidates.map((c) => (
                                            <button
                                              key={c.id}
                                              onClick={() => {
                                                const next = new Map(unmatchedSelections);
                                                next.set(u.janCode, { mode: "existing", existingProductId: c.id });
                                                setUnmatchedSelections(next);
                                              }}
                                              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-secondary/80 border border-border/30 truncate max-w-48"
                                            >
                                              {c.name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`match-${u.janCode}`}
                                    checked={sel.mode === "new"}
                                    onChange={() => {
                                      const next = new Map(unmatchedSelections);
                                      next.set(u.janCode, { mode: "new", existingProductId: null });
                                      setUnmatchedSelections(next);
                                    }}
                                    className="w-3.5 h-3.5"
                                  />
                                  <span className="text-xs">新規商品として登録</span>
                                  {sel.mode === "new" && (
                                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-400/50 px-1.5 py-0">
                                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />商品マスタ未登録
                                    </Badge>
                                  )}
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 text-muted-foreground">
                          <th className="text-left py-3 px-4 font-medium">商品名</th>
                          <th className="text-right py-3 px-4 font-medium">現在庫</th>
                          <th className="text-right py-3 px-4 font-medium">売上数</th>
                          <th className="text-right py-3 px-4 font-medium">インポート後</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.matched.map((m, i) => (
                          <tr key={i} className="border-b border-border/30 transition-colors">
                            <td className="py-3 px-4 font-medium">{m.productName}</td>
                            <td className="py-3 px-4 text-right font-num">{m.currentStock ?? "—"}</td>
                            <td className="py-3 px-4 text-right font-num">{m.soldQty}</td>
                            <td className={`py-3 px-4 text-right font-num font-semibold ${m.afterStock !== null && m.afterStock < 0 ? "text-red-500" : ""}`}>
                              {m.currentStock !== null && m.afterStock !== null
                                ? `${m.currentStock} → ${m.afterStock}${m.afterStock < 0 ? " ⚠️" : ""}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {previewData.matched.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">マッチした商品がありません</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">プレビューデータを取得できませんでした</p>
              )}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); setParsedRows([]); setPreviewData(null); }}>
                <ArrowLeft className="w-4 h-4 mr-2" /> キャンセル
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90"
                onClick={() => {
                  // 「既存商品に統合」を選んだが商品を選択していない行がないかチェック
                  const invalid = Array.from(unmatchedSelections.entries()).find(
                    ([, sel]) => sel.mode === "existing" && !sel.existingProductId
                  );
                  if (invalid) {
                    toast({ title: "選択エラー", description: "「既存商品に統合」を選択した場合は商品を選んでください", variant: "destructive" });
                    return;
                  }
                  // マッチオーバーライドがある場合は確認ダイアログ
                  const hasOverrides = Array.from(unmatchedSelections.values()).some((sel) => sel.mode === "existing" && sel.existingProductId);
                  if (hasOverrides) {
                    setShowConfirmDialog(true);
                  } else {
                    setStep(2);
                  }
                }}
                disabled={previewLoading}
              >
                確定してインポート <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>

            {/* 商品情報更新の確認ダイアログ */}
            {showConfirmDialog && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card p-6 max-w-lg w-full mx-4 space-y-4">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    商品情報の更新確認
                  </h3>
                  <p className="text-sm text-muted-foreground">以下の既存商品のJANコード・商品名がスマレジのデータに上書きされます。この操作は元に戻せません。</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {Array.from(unmatchedSelections.entries())
                      .filter(([, sel]) => sel.mode === "existing" && sel.existingProductId)
                      .map(([janCode, sel]) => {
                        const unmatchedItem = previewData?.unmatched.find((u) => u.janCode === janCode);
                        const existingProduct = allProducts.find((p) => p.id === sel.existingProductId);
                        return (
                          <div key={janCode} className="border border-border/30 rounded p-2.5 text-xs space-y-1">
                            <p className="text-muted-foreground">既存: <span className="text-foreground font-medium">{existingProduct?.name}</span> ({existingProduct?.janCode})</p>
                            <p className="text-primary">↓ 更新後: <span className="font-medium">{unmatchedItem?.productName}</span> ({janCode})</p>
                          </div>
                        );
                      })}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setShowConfirmDialog(false)}>キャンセル</Button>
                    <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => { setShowConfirmDialog(false); setStep(2); }}>
                      更新してインポート
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{file?.name || "sample.csv"}</p>
                    <p className="text-xs text-muted-foreground">CSVタイプ: {csvType === "PRODUCT_SALES" ? "商品別売上" : "月別売上"}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setStep(0); setFile(null); setParsedRows([]); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">期間: </span>
                  <Input value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="inline w-28 h-8 bg-secondary/50 border-border/50 text-sm mx-1" />
                  〜
                  <Input value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="inline w-28 h-8 bg-secondary/50 border-border/50 text-sm mx-1" />
                </div>
                <div>
                  <span className="text-muted-foreground">取込件数: </span>
                  <span className="font-num font-semibold">{parsedRows.length}件</span>
                </div>
              </div>
              {(() => {
                const autoRegisterCount = previewData?.unmatched.filter(
                  (u) => !unmatchedSelections.get(u.janCode) || unmatchedSelections.get(u.janCode)?.mode === "new"
                ).length || 0;
                return autoRegisterCount > 0 ? (
                  <div className="border border-amber-400/30 bg-amber-400/5 rounded-lg p-3 mt-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span className="text-sm text-amber-400 font-medium">新規自動登録: {autoRegisterCount}件</span>
                    <span className="text-xs text-muted-foreground">（要確認商品として登録されます）</span>
                  </div>
                ) : null;
              })()}
            </div>

            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      {csvType === "PRODUCT_SALES" ? (
                        <>
                          <th className="text-left py-3 px-4 font-medium">商品コード</th>
                          <th className="text-left py-3 px-4 font-medium">部門名</th>
                          <th className="text-left py-3 px-4 font-medium">商品名</th>
                          <th className="text-right py-3 px-4 font-medium">販売点数</th>
                          <th className="text-right py-3 px-4 font-medium">売上金額</th>
                        </>
                      ) : (
                        <>
                          <th className="text-left py-3 px-4 font-medium">日付</th>
                          <th className="text-right py-3 px-4 font-medium">販売点数</th>
                          <th className="text-right py-3 px-4 font-medium">純売上</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-b border-border/30 transition-colors">
                        {csvType === "PRODUCT_SALES" ? (
                          <>
                            <td className="py-3 px-4 font-num text-muted-foreground">{r.janCode}</td>
                            <td className="py-3 px-4">{r.category}</td>
                            <td className="py-3 px-4 font-medium">{r.name}</td>
                            <td className="py-3 px-4 text-right font-num">{r.qty}</td>
                            <td className="py-3 px-4 text-right font-num">¥{r.sales.toLocaleString()}</td>
                          </>
                        ) : (
                          <>
                            <td className="py-3 px-4 font-num">{r.name}</td>
                            <td className="py-3 px-4 text-right font-num">{r.qty}</td>
                            <td className="py-3 px-4 text-right font-num">¥{r.sales.toLocaleString()}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 20 && (
                  <p className="text-xs text-muted-foreground text-center py-3">他 {parsedRows.length - 20} 件を省略...</p>
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); setParsedRows([]); }}>
                <ArrowLeft className="w-4 h-4 mr-2" /> 戻る
              </Button>
              <Button className="bg-primary hover:bg-primary/90" onClick={handleImport} disabled={importing}>
                {importing ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2" />
                ) : null}
                {importing ? "インポート中..." : "インポート確定"} {!importing && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="complete" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-edo-success/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-edo-success" />
            </div>
            <h2 className="text-xl font-semibold mb-2">インポート完了</h2>
            <p className="text-muted-foreground mb-6">CSVデータが正常に取り込まれました</p>
            <div className="flex justify-center gap-8 mb-8 text-sm">
              <div><span className="text-muted-foreground">取込件数: </span><span className="font-num font-semibold">{importResult?.recordCount || 0}件</span></div>
              <div><span className="text-muted-foreground">在庫反映: </span><span className="font-num font-semibold text-edo-success">完了</span></div>
              {(importResult?.autoCreatedCount || 0) > 0 && (
                <div><span className="text-muted-foreground">新規自動登録: </span><span className="font-num font-semibold text-amber-400">{importResult?.autoCreatedCount}件</span></div>
              )}
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); setParsedRows([]); setImportResult(null); }}>続けてインポート</Button>
              <Button className="bg-primary hover:bg-primary/90" onClick={() => window.location.href = "/"}>ダッシュボードへ</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* インポート履歴 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
        <h3 className="text-base font-semibold mb-4">インポート履歴</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left py-2 px-4 font-medium">ファイル名</th>
                <th className="text-left py-2 px-4 font-medium">タイプ</th>
                <th className="text-right py-2 px-4 font-medium">件数</th>
                <th className="text-right py-2 px-4 font-medium">インポート日時</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="py-2 px-4"><FileText className="w-3.5 h-3.5 inline mr-2 text-muted-foreground" />{h.filename}</td>
                  <td className="py-2 px-4 text-muted-foreground">{
                    h.csvType === "PRODUCT_SALES" ? "商品別売上" :
                      h.csvType === "MONTHLY_SALES" ? "月別売上" :
                        h.csvType === "PURCHASE_ETOILE" ? "仕入：エトワール海渡" :
                          h.csvType === "PURCHASE_COREC" ? "仕入：コレック" :
                            h.csvType === "PURCHASE_JANNU" ? "仕入：ジャヌツー" :
                              h.csvType
                  }</td>
                  <td className="py-2 px-4 text-right font-num">{h.recordCount}</td>
                  <td className="py-2 px-4 text-right font-num text-muted-foreground">{new Date(h.importedAt).toLocaleString("ja-JP")}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">まだインポート履歴がありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

// ========================
// 仕入データタブ（新規）
// ========================
const PurchaseImportTab = ({ toast }: { toast: any }) => {
  const [step, setStep] = useState(0); // 0=upload, 1=preview, 2=complete
  const [supplier, setSupplier] = useState("etoile");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [matchResults, setMatchResults] = useState<PurchaseMatchResult[]>([]);
  const [corecItems, setCorecItems] = useState<CorecItem[]>([]);
  const [jannuItems, setJannuItems] = useState<JannuItem[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ addedCount: number; totalQuantity: number; processed?: number; skipped?: number; newlyRegistered?: number } | null>(null);

  // Track which unmatched rows should be auto-registered (default: all ON)
  const [autoRegisterSet, setAutoRegisterSet] = useState<Set<number>>(new Set());
  const [dupWarning, setDupWarning] = useState<HistoryItem | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // ユーザーが手動で選択した商品マッピング (row → productId)
  const [jannuProductSelections, setJannuProductSelections] = useState<Map<number, number>>(new Map());
  const [etoileProductSelections, setEtoileProductSelections] = useState<Map<number, number>>(new Map());
  const [corecProductSelections, setCorecProductSelections] = useState<Map<number, number>>(new Map());
  // 商品マスタ一覧（ドロップダウン用）
  const [allProducts, setAllProducts] = useState<{ id: number; name: string }[]>([]);
  // エトワール注文番号（重複防止用）
  const [etoileOrderNumber, setEtoileOrderNumber] = useState<string>("");

  const currentSupplier = suppliers.find((s) => s.value === supplier)!;

  const validateFileExt = (f: File): boolean => {
    const ext = f.name.toLowerCase().split(".").pop() || "";
    const allowed = currentSupplier.accept.split(",").map((a) => a.trim().replace(".", ""));
    if (!allowed.includes(ext)) {
      toast({ title: "ファイル形式エラー", description: `${currentSupplier.label}には ${currentSupplier.accept} 形式のファイルを選択してください`, variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleFile = async (f: File) => {
    if (!validateFileExt(f)) return;
    setFile(f);

    if (supplier === "etoile") {
      // Parse CSV with PapaParse
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: async (result) => {
            const records = result.data as Record<string, string>[];
            setImporting(true);
            try {
              const res = await fetch("/api/purchase-import/etoile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ records }),
              });
              const data = await res.json();
              if (res.ok) {
                setMatchResults(data.results);
                setSummary(data.summary);
                setEtoileOrderNumber(data.orderNumber || "");
                // エトワールは自動登録しないのでautoRegisterSetは空のまま
                // 商品マスタをフェッチ（ドロップダウン用）
                fetch("/api/products", { credentials: "include" })
                  .then((r) => r.json())
                  .then((d) => { setAllProducts(Array.isArray(d) ? d : []); })
                  .catch(() => {});
                setStep(1);
              } else {
                toast({ title: "エラー", description: data.error, variant: "destructive" });
              }
            } catch {
              toast({ title: "接続エラー", description: "マッチング処理に失敗しました", variant: "destructive" });
            } finally {
              setImporting(false);
            }
          },
        });
      };
      reader.readAsText(f, "UTF-8");
    } else if (supplier === "corec") {
      // Send PDF via FormData
      setImporting(true);
      try {
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/purchase-import/corec/parse", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          const items: CorecItem[] = data.items;
          setCorecItems(items);
          const matched = items.filter((i) => i.matched).length;
          const unmatched = items.filter((i) => !i.matched).length;
          const unmatchedRows = new Set<number>(items.filter((i: CorecItem) => !i.matched).map((i: CorecItem) => i.row));
          setAutoRegisterSet(unmatchedRows);
          setSummary({
            total: items.length,
            matched,
            unmatched,
            totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
            totalCost: items.reduce((sum, i) => sum + i.subtotal, 0),
          });
          // 商品マスタをフェッチ（ドロップダウン用）
          fetch("/api/products", { credentials: "include" })
            .then((r) => r.json())
            .then((d) => { setAllProducts(Array.isArray(d) ? d : []); })
            .catch(() => {});
          setStep(1);
        } else {
          toast({ title: "PDF解析エラー", description: data.error || "解析に失敗しました", variant: "destructive" });
        }
      } catch {
        toast({ title: "接続エラー", description: "PDF解析処理に失敗しました", variant: "destructive" });
      } finally {
        setImporting(false);
      }
    } else if (supplier === "jannu") {
      // Send Excel via FormData
      setImporting(true);
      try {
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/purchase-import/jannu/parse", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          const items: JannuItem[] = data.items;
          setJannuItems(items);
          const matched = items.filter((i) => i.matched).length;
          const unmatched = items.filter((i) => !i.matched).length;
          const unmatchedRows = new Set<number>(items.filter((i: JannuItem) => !i.matched).map((i: JannuItem) => i.row));
          setAutoRegisterSet(unmatchedRows);
          setSummary({
            total: items.length,
            matched,
            unmatched,
            totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
            totalCost: 0,
          });
          // 商品マスタをフェッチ（ドロップダウン用）
          fetch("/api/products", { credentials: "include" })
            .then((r) => r.json())
            .then((d) => { setAllProducts(Array.isArray(d) ? d : []); })
            .catch(() => {});
          setStep(1);
        } else {
          toast({ title: "Excel解析エラー", description: data.error || "解析に失敗しました", variant: "destructive" });
        }
      } catch {
        toast({ title: "接続エラー", description: "Excel解析処理に失敗しました", variant: "destructive" });
      } finally {
        setImporting(false);
      }
    } else {
      toast({ title: "未対応", description: `${currentSupplier.label}のインポートは準備中です`, variant: "destructive" });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      handleFile(f);
    }
  };

  // === 二重インポート防止 ===
  const checkDupThenHandle = async (f: File) => {
    if (!validateFileExt(f)) return;
    try {
      const res = await fetch("/api/csv/history", { credentials: "include" });
      const hist: HistoryItem[] = await res.json();
      const found = hist.find((h) => h.filename === f.name);
      if (found) {
        setPendingFile(f);
        setDupWarning(found);
      } else {
        handleFile(f);
      }
    } catch {
      handleFile(f);
    }
  };

  const handleDropWithDupCheck = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) checkDupThenHandle(f);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      if (supplier === "corec") {
        const corecMappings = Array.from(corecProductSelections.entries())
          .map(([row, productId]) => {
            const item = corecItems.find((i) => i.row === row);
            if (!item) return null;
            return { supplierProductName: `${item.hinban} ${item.productName}`.trim(), productId };
          })
          .filter(Boolean);
        const itemsWithAutoRegister = corecItems.map((item) => {
          const selectedProductId = corecProductSelections.get(item.row);
          return {
            ...item,
            matchedProductId: item.matchedProductId || selectedProductId || null,
            autoRegister: !item.matched && !selectedProductId && autoRegisterSet.has(item.row),
          };
        });
        const res = await fetch("/api/purchase-import/corec/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items: itemsWithAutoRegister, filename: file?.name || "corec_import.pdf", mappings: corecMappings }),
        });
        const data = await res.json();
        if (res.ok) {
          setConfirmResult({ addedCount: data.processed, totalQuantity: summary?.totalQuantity || 0, processed: data.processed, skipped: data.skipped, newlyRegistered: data.newlyRegistered });
          setStep(2);
          toast({ title: "入庫完了", description: `${data.processed}品目を入庫しました${data.newlyRegistered ? `（${data.newlyRegistered}品自動登録）` : ""}` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
        }
      } else if (supplier === "jannu") {
        // ユーザーが手動選択した商品を items に反映し、mappings 配列を構築
        const mappings = Array.from(jannuProductSelections.entries())
          .map(([row, productId]) => {
            const item = jannuItems.find((i) => i.row === row);
            if (!item) return null;
            return { supplierProductName: item.supplierProductName, productId };
          })
          .filter(Boolean);

        const itemsWithAutoRegister = jannuItems.map((item) => {
          const selectedProductId = jannuProductSelections.get(item.row);
          return {
            ...item,
            matchedProductId: item.matchedProductId || selectedProductId || null,
            autoRegister: !item.matched && !selectedProductId && autoRegisterSet.has(item.row),
          };
        });
        const res = await fetch("/api/purchase-import/jannu/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items: itemsWithAutoRegister, filename: file?.name || "jannu_import.xlsx", mappings }),
        });
        const data = await res.json();
        if (res.ok) {
          setConfirmResult({ addedCount: data.processed, totalQuantity: summary?.totalQuantity || 0, processed: data.processed, skipped: data.skipped, newlyRegistered: data.newlyRegistered });
          setStep(2);
          toast({ title: "入庫完了", description: `${data.processed}品目を入庫しました${data.newlyRegistered ? `（${data.newlyRegistered}品自動登録）` : ""}` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
        }
      } else {
        const etoileMappings = Array.from(etoileProductSelections.entries())
          .map(([row, productId]) => {
            const item = matchResults.find((r) => r.row === row);
            if (!item) return null;
            return { supplierProductName: item.csvName, productId };
          })
          .filter(Boolean);
        const itemsForConfirm = matchResults.map((item) => {
          const selectedProductId = etoileProductSelections.get(item.row);
          return {
            ...item,
            matchedId: item.matchedId || selectedProductId || null,
          };
        });
        const res = await fetch("/api/purchase-import/etoile/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items: itemsForConfirm, orderNumber: etoileOrderNumber, mappings: etoileMappings }),
        });
        const data = await res.json();
        if (res.ok) {
          setConfirmResult({ addedCount: data.addedCount, totalQuantity: data.totalQuantity, skipped: data.skipped });
          setStep(2);
          toast({ title: "入庫完了", description: `${data.addedCount}品目 / ${data.totalQuantity}点を入庫しました${data.skipped ? `（${data.skipped}件スキップ）` : ""}` });
        } else {
          toast({ title: "エラー", description: data.error, variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "接続エラー", description: "確定処理に失敗しました", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setStep(0);
    setFile(null);
    setMatchResults([]);
    setCorecItems([]);
    setJannuItems([]);
    setSummary(null);
    setConfirmResult(null);
    setAutoRegisterSet(new Set());
    setJannuProductSelections(new Map());
    setEtoileProductSelections(new Map());
    setCorecProductSelections(new Map());
    setAllProducts([]);
    setEtoileOrderNumber("");
  };

  return (
    <div className="space-y-6">
      {/* ステップインジケーター */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4">
        <div className="flex items-center justify-center gap-2">
          {["ファイル選択", "マッチング確認", "入庫完了"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-num font-semibold transition-colors",
                i <= step ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}>
                {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={cn("text-sm hidden sm:inline", i <= step ? "text-foreground" : "text-muted-foreground")}>{s}</span>
              {i < 2 && <div className={cn("w-12 h-0.5 mx-2", i < step ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {/* Step 0: ファイル選択 */}
        {step === 0 && (
          <motion.div key="upload" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-5">
              <label className="text-sm font-medium block mb-2">仕入先を選択</label>
              <Select value={supplier} onValueChange={setSupplier}>
                <SelectTrigger className="w-56 bg-secondary/50 border-border/50 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDropWithDupCheck}
              className={cn(
                "glass-card border-2 border-dashed p-16 text-center transition-all cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/30",
                importing && "pointer-events-none opacity-50"
              )}
              onClick={() => document.getElementById("purchase-input")?.click()}
            >
              {importing ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-12 h-12 border-3 border-primary/30 border-t-primary rounded-full mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">マッチング処理中...</p>
                  <p className="text-sm text-muted-foreground">商品マスタとの照合を行っています</p>
                </>
              ) : (
                <>
                  <Upload className={cn("w-12 h-12 mx-auto mb-4 transition-colors", dragOver ? "text-primary" : "text-muted-foreground")} />
                  <p className="text-lg font-medium mb-2">{currentSupplier.dropText}</p>
                  <p className="text-sm text-muted-foreground mb-4">またはクリックしてファイルを選択</p>
                  <p className="text-xs text-muted-foreground">対応形式: {currentSupplier.accept}</p>
                </>
              )}
              <input
                id="purchase-input"
                type="file"
                accept={currentSupplier.accept}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) checkDupThenHandle(f); }}
              />
            </div>
            {dupWarning && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 glass-card p-4 border border-amber-400/30 bg-amber-400/5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-400">⚠️ このファイルは過去にインポート済みです</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      インポート日時: {new Date(dupWarning.importedAt).toLocaleString("ja-JP")}
                      {dupWarning.user && ` / ユーザー: ${dupWarning.user.name}`}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => { setDupWarning(null); setPendingFile(null); }}>
                    キャンセル
                  </Button>
                  <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => { const f = pendingFile; setDupWarning(null); setPendingFile(null); if (f) handleFile(f); }}>
                    続けてインポート
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Step 1: マッチングプレビュー */}
        {step === 1 && summary && (
          <motion.div key="preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            {/* サマリーカード */}
            <div className={cn("grid gap-3", supplier === "jannu" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4")}>
              <div className="glass-card p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">総SKU数</p>
                <p className="text-xl font-num font-bold">{summary.total}</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">マッチ</p>
                <p className="text-xl font-num font-bold text-edo-success">{summary.matched}</p>
              </div>
              <div className="glass-card p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">未マッチ</p>
                <p className="text-xl font-num font-bold text-primary">{summary.unmatched}</p>
              </div>
              {supplier !== "jannu" && (
                <div className="glass-card p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">合計金額</p>
                  <p className="text-xl font-num font-bold">¥{summary.totalCost.toLocaleString()}</p>
                </div>
              )}
            </div>

            {/* 注意バナー（未マッチあり） */}
            {summary.unmatched > 0 && supplier === "etoile" ? (
              <div className="glass-card p-4 border-amber-400/20 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-amber-400">{summary.unmatched}件</span>
                  の未マッチ商品があります。ドロップダウンから対応する商品を選択してください。選択しない商品はスキップされます。
                  <br />
                  <span className="text-[11px] text-muted-foreground">※ 対応する商品がない場合は、先にスマレジで商品を登録してください。</span>
                </p>
              </div>
            ) : summary.unmatched > 0 ? (
              <div className="glass-card p-4 border-edo-info/20 flex items-center gap-3">
                <Plus className="w-5 h-5 text-edo-info flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-edo-info">{autoRegisterSet.size}件</span>
                  の未マッチ商品を自動登録して入庫します。チェックを外した商品はスキップされます。
                </p>
              </div>
            ) : null}

            {/* マッチ結果テーブル */}
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-center py-3 px-3 font-medium w-10">状態</th>
                      {supplier === "jannu" ? (
                        <>
                          <th className="text-left py-3 px-3 font-medium">柄名</th>
                          <th className="text-left py-3 px-3 font-medium">カラー</th>
                          <th className="text-center py-3 px-3 font-medium">サイズ</th>
                        </>
                      ) : (
                        <>
                          <th className="text-left py-3 px-3 font-medium">商品名</th>
                          <th className="text-left py-3 px-3 font-medium">JANコード</th>
                        </>
                      )}
                      {supplier === "etoile" && <th className="text-right py-3 px-3 font-medium">num</th>}
                      {supplier === "etoile" && <th className="text-right py-3 px-3 font-medium">卸単位</th>}
                      <th className="text-right py-3 px-3 font-medium">数量</th>
                      {supplier === "etoile" && <th className="text-right py-3 px-3 font-medium">単価</th>}
                      {supplier === "etoile" && <th className="text-right py-3 px-3 font-medium">小計</th>}
                      <th className="text-left py-3 px-3 font-medium">マッチ先</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplier === "jannu" ? (
                      jannuItems.map((item) => {
                        const isAutoReg = !item.matched && autoRegisterSet.has(item.row);
                        return (
                          <tr
                            key={item.row}
                            className={cn(
                              "border-b border-border/30 transition-colors",
                              item.matched && "bg-edo-success/5",
                              !item.matched && isAutoReg && "bg-edo-info/10",
                              !item.matched && !isAutoReg && "bg-edo-warning/10"
                            )}
                          >
                            <td className="py-3 px-3 text-center">
                              {item.matched ? (
                                <Badge className="bg-edo-success/15 text-edo-success border-edo-success/30 text-[10px]">✓</Badge>
                              ) : isAutoReg ? (
                                <input type="checkbox" checked={true} onChange={() => { const s = new Set(autoRegisterSet); s.delete(item.row); setAutoRegisterSet(s); }} className="w-4 h-4 accent-[hsl(var(--edo-info))] cursor-pointer" />
                              ) : (
                                <input type="checkbox" checked={false} onChange={() => { const s = new Set(autoRegisterSet); s.add(item.row); setAutoRegisterSet(s); }} className="w-4 h-4 cursor-pointer" />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <p className="font-medium text-xs">{item.design}</p>
                              {item.modelCode && <p className="text-[10px] text-muted-foreground font-num">{item.modelCode}</p>}
                            </td>
                            <td className="py-3 px-3 text-xs">{item.color}</td>
                            <td className="py-3 px-3 text-center font-num text-xs">{item.size}</td>
                            <td className="py-3 px-3 text-right font-num">{item.quantity}</td>
                            <td className="py-3 px-3">
                              {item.matchedProductName ? (
                                <span className="text-xs text-edo-success">{item.matchedProductName}</span>
                              ) : (
                                <div className="space-y-1">
                                  <ProductCombobox
                                    products={allProducts}
                                    value={jannuProductSelections.get(item.row) ?? null}
                                    onSelect={(productId) => {
                                      const s = new Map(jannuProductSelections);
                                      if (productId) s.set(item.row, productId);
                                      else s.delete(item.row);
                                      setJannuProductSelections(s);
                                    }}
                                  />
                                  {!jannuProductSelections.has(item.row) && isAutoReg && (
                                    <span className="text-[10px] text-edo-info">選択しなければ新規登録</span>
                                  )}
                                  {!jannuProductSelections.has(item.row) && !isAutoReg && (
                                    <span className="text-[10px] text-muted-foreground italic">スキップ</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : supplier === "corec" ? (
                      corecItems.map((item) => {
                        const isAutoReg = !item.matched && autoRegisterSet.has(item.row);
                        return (
                          <tr
                            key={item.row}
                            className={cn(
                              "border-b border-border/30 transition-colors",
                              item.matched && "bg-edo-success/5",
                              !item.matched && isAutoReg && "bg-edo-info/10",
                              !item.matched && !isAutoReg && "bg-edo-warning/10"
                            )}
                          >
                            <td className="py-3 px-3 text-center">
                              {item.matched ? (
                                <Badge className="bg-edo-success/15 text-edo-success border-edo-success/30 text-[10px]">✓</Badge>
                              ) : isAutoReg ? (
                                <input type="checkbox" checked={true} onChange={() => { const s = new Set(autoRegisterSet); s.delete(item.row); setAutoRegisterSet(s); }} className="w-4 h-4 accent-[hsl(var(--edo-info))] cursor-pointer" />
                              ) : (
                                <input type="checkbox" checked={false} onChange={() => { const s = new Set(autoRegisterSet); s.add(item.row); setAutoRegisterSet(s); }} className="w-4 h-4 cursor-pointer" />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <p className="font-medium text-xs">{item.productName}</p>
                              <p className="text-[10px] text-muted-foreground font-num">品番: {item.hinban}</p>
                            </td>
                            <td className="py-3 px-3 font-num text-xs">{item.janCode}</td>
                            <td className="py-3 px-3 text-right font-num">{item.quantity}</td>
                            <td className="py-3 px-3">
                              {item.matchedProductName ? (
                                <span className="text-xs text-edo-success">{item.matchedProductName}</span>
                              ) : (
                                <div className="space-y-1">
                                  <ProductCombobox
                                    products={allProducts}
                                    value={corecProductSelections.get(item.row) ?? null}
                                    onSelect={(productId) => {
                                      const s = new Map(corecProductSelections);
                                      if (productId) s.set(item.row, productId);
                                      else s.delete(item.row);
                                      setCorecProductSelections(s);
                                    }}
                                  />
                                  {!corecProductSelections.has(item.row) && isAutoReg && (
                                    <span className="text-[10px] text-edo-info">選択しなければ新規登録</span>
                                  )}
                                  {!corecProductSelections.has(item.row) && !isAutoReg && (
                                    <span className="text-[10px] text-muted-foreground italic">スキップ</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      matchResults.map((r) => {
                        return (
                          <tr
                            key={r.row}
                            className={cn(
                              "border-b border-border/30 transition-colors",
                              r.status === "matched" && "bg-edo-success/5",
                              r.status === "unmatched" && etoileProductSelections.has(r.row) && "bg-edo-info/10",
                              r.status === "unmatched" && !etoileProductSelections.has(r.row) && "bg-edo-warning/10"
                            )}
                          >
                            <td className="py-3 px-3 text-center">
                              {r.status === "matched" ? (
                                <Badge className="bg-edo-success/15 text-edo-success border-edo-success/30 text-[10px]">✓</Badge>
                              ) : etoileProductSelections.has(r.row) ? (
                                <Badge className="bg-edo-info/15 text-edo-info border-edo-info/30 text-[10px]">✓</Badge>
                              ) : (
                                <Badge className="bg-amber-400/15 text-amber-400 border-amber-400/30 text-[10px]">?</Badge>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <p className="font-medium text-xs">{r.csvName}</p>
                            </td>
                            <td className="py-3 px-3 font-num text-xs">{r.janCode || r.itemCode}</td>
                            <td className="py-3 px-3 text-right font-num">{r.num}</td>
                            <td className="py-3 px-3 text-right font-num">{r.wholesaleUnit}</td>
                            <td className="py-3 px-3 text-right font-num font-medium">{r.quantity}</td>
                            <td className="py-3 px-3 text-right font-num">¥{r.unitCost.toLocaleString()}</td>
                            <td className="py-3 px-3 text-right font-num">¥{r.subtotal.toLocaleString()}</td>
                            <td className="py-3 px-3">
                              {r.matchedProduct ? (
                                <span className="text-xs text-edo-success">{r.matchedProduct}</span>
                              ) : (
                                <div className="space-y-1">
                                  <ProductCombobox
                                    products={allProducts}
                                    value={etoileProductSelections.get(r.row) ?? null}
                                    onSelect={(productId) => {
                                      const s = new Map(etoileProductSelections);
                                      if (productId) s.set(r.row, productId);
                                      else s.delete(r.row);
                                      setEtoileProductSelections(s);
                                    }}
                                  />
                                  {!etoileProductSelections.has(r.row) && (
                                    <span className="text-[10px] text-muted-foreground italic">スキップ（商品を選択してください）</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={reset}>
                <ArrowLeft className="w-4 h-4 mr-2" /> 戻る
              </Button>
              {(() => {
                // ジャヌツーはドロップダウン選択分も含めた実効カウントを算出
                const confirmCount = supplier === "jannu"
                  ? summary.matched
                    + jannuProductSelections.size
                    + Array.from(autoRegisterSet).filter((r) => !jannuProductSelections.has(r)).length
                  : supplier === "etoile"
                  ? summary.matched
                    + etoileProductSelections.size
                  : supplier === "corec"
                  ? summary.matched
                    + corecProductSelections.size
                    + Array.from(autoRegisterSet).filter((r) => !corecProductSelections.has(r)).length
                  : summary.matched + autoRegisterSet.size;
                return (
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    onClick={handleConfirm}
                    disabled={confirming || confirmCount === 0}
                  >
                    {confirming ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2" />
                    ) : null}
                    {confirming ? "入庫中..." : `${confirmCount}品目を入庫確定`}
                    {!confirming && <ArrowRight className="w-4 h-4 ml-2" />}
                  </Button>
                );
              })()}
            </div>
          </motion.div>
        )}

        {/* Step 2: 完了 */}
        {step === 2 && (
          <motion.div key="complete" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-edo-success/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-edo-success" />
            </div>
            <h2 className="text-xl font-semibold mb-2">入庫完了</h2>
            <p className="text-muted-foreground mb-6">{currentSupplier.label}からの仕入データを在庫に反映しました</p>
            <div className="flex justify-center gap-8 mb-8 text-sm">
              <div><span className="text-muted-foreground">入庫品目: </span><span className="font-num font-semibold">{confirmResult?.processed ?? confirmResult?.addedCount ?? 0}品目</span></div>
              {confirmResult?.newlyRegistered != null && confirmResult.newlyRegistered > 0 && (
                <div><span className="text-muted-foreground">新規登録: </span><span className="font-num font-semibold text-edo-info">{confirmResult.newlyRegistered}品目</span></div>
              )}
              {(supplier === "corec" || supplier === "jannu" || supplier === "etoile") && confirmResult?.skipped != null && (
                <div><span className="text-muted-foreground">スキップ: </span><span className="font-num font-semibold text-muted-foreground">{confirmResult.skipped}件</span></div>
              )}
              <div><span className="text-muted-foreground">入庫数量: </span><span className="font-num font-semibold text-edo-success">{confirmResult?.totalQuantity || 0}点</span></div>
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={reset}>続けてインポート</Button>
              <Button className="bg-primary hover:bg-primary/90" onClick={() => window.location.href = "/inventory"}>在庫一覧へ</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CsvImport;
