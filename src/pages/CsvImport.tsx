import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, CheckCircle, AlertTriangle, ArrowRight, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const steps = ["アップロード", "プレビュー", "完了"];

interface ParsedRow {
  janCode: string;
  category: string;
  name: string;
  qty: number;
  sales: number;
  isNew: boolean;
}

const mockParsed: ParsedRow[] = [
  { janCode: "4970974502274", category: "☆　その他　雑貨", name: "タオル　桜富士", qty: 82, sales: 81180, isNew: false },
  { janCode: "4970974503684", category: "特売", name: "特売　1200", qty: 39, sales: 46800, isNew: false },
  { janCode: "4970974100005", category: "佃煮　自社製造", name: "江戸一昆布", qty: 75, sales: 37175, isNew: false },
  { janCode: "4970974101262", category: "佃煮　自社製造", name: "一口ほたて(大)", qty: 26, sales: 23220, isNew: false },
  { janCode: "4970974503639", category: "☆　Tシャツ", name: "ハット", qty: 4, sales: 18000, isNew: true },
  { janCode: "4970974503516", category: "☆　Tシャツ", name: "ジップパーカー　ブラウン　XL", qty: 2, sales: 14000, isNew: false },
];

const mockHistory = [
  { id: 1, filename: "商品別売上サンプル(期間：20260223-20260301).csv", period: "2026/02/23 - 2026/03/01", records: 106, date: "2026/03/01 14:30" },
  { id: 2, filename: "商品別売上(期間：20260216-20260222).csv", period: "2026/02/16 - 2026/02/22", records: 98, date: "2026/02/23 10:15" },
];

const CsvImport = () => {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) {
      setFile(f);
      setStep(1);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setStep(1);
    }
  };

  return (
    <div className="space-y-6">
      {/* ステップインジケーター */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4"
      >
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
        {/* Step 1: アップロード */}
        {step === 0 && (
          <motion.div key="upload" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "glass-card border-2 border-dashed p-16 text-center transition-all cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/30"
              )}
              onClick={() => document.getElementById("csv-input")?.click()}
            >
              <Upload className={cn("w-12 h-12 mx-auto mb-4 transition-colors", dragOver ? "text-primary" : "text-muted-foreground")} />
              <p className="text-lg font-medium mb-2">CSVファイルをドラッグ＆ドロップ</p>
              <p className="text-sm text-muted-foreground mb-4">または、クリックしてファイルを選択</p>
              <p className="text-xs text-muted-foreground">対応形式: スマレジ 商品別売上CSV / 月別売上CSV</p>
              <input id="csv-input" type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
            </div>
          </motion.div>
        )}

        {/* Step 2: プレビュー */}
        {step === 1 && (
          <motion.div key="preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{file?.name || "sample.csv"}</p>
                    <p className="text-xs text-muted-foreground">CSVタイプ: 商品別売上</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setStep(0); setFile(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">期間: </span>
                  <Input defaultValue="2026/02/23" className="inline w-28 h-8 bg-secondary/50 border-border/50 text-sm mx-1" />
                  〜
                  <Input defaultValue="2026/03/01" className="inline w-28 h-8 bg-secondary/50 border-border/50 text-sm mx-1" />
                </div>
                <div>
                  <span className="text-muted-foreground">取込件数: </span>
                  <span className="font-num font-semibold">{mockParsed.length}件</span>
                </div>
                <div>
                  <span className="text-muted-foreground">新規商品: </span>
                  <span className="font-num font-semibold text-edo-warning">{mockParsed.filter(r => r.isNew).length}件</span>
                </div>
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-left py-3 px-4 font-medium">商品コード</th>
                      <th className="text-left py-3 px-4 font-medium">部門名</th>
                      <th className="text-left py-3 px-4 font-medium">商品名</th>
                      <th className="text-right py-3 px-4 font-medium">販売点数</th>
                      <th className="text-right py-3 px-4 font-medium">純売上</th>
                      <th className="text-center py-3 px-4 font-medium">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockParsed.map((r, i) => (
                      <tr key={i} className={cn("border-b border-border/30 transition-colors", r.isNew && "bg-edo-warning/5")}>
                        <td className="py-3 px-4 font-num text-muted-foreground">{r.janCode}</td>
                        <td className="py-3 px-4">{r.category}</td>
                        <td className="py-3 px-4 font-medium">{r.name}</td>
                        <td className="py-3 px-4 text-right font-num">{r.qty}</td>
                        <td className="py-3 px-4 text-right font-num">¥{r.sales.toLocaleString()}</td>
                        <td className="py-3 px-4 text-center">
                          {r.isNew ? (
                            <Badge className="bg-edo-warning/15 text-edo-warning border-edo-warning/30 text-xs">新規</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-border/50">既存</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); }}>
                <ArrowLeft className="w-4 h-4 mr-2" /> 戻る
              </Button>
              <Button className="bg-primary hover:bg-primary/90" onClick={() => setStep(2)}>
                インポート確定 <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 3: 完了 */}
        {step === 2 && (
          <motion.div key="complete" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-edo-success/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-edo-success" />
            </div>
            <h2 className="text-xl font-semibold mb-2">インポート完了</h2>
            <p className="text-muted-foreground mb-6">CSVデータが正常に取り込まれました</p>
            <div className="flex justify-center gap-8 mb-8 text-sm">
              <div><span className="text-muted-foreground">取込件数: </span><span className="font-num font-semibold">{mockParsed.length}件</span></div>
              <div><span className="text-muted-foreground">新規登録: </span><span className="font-num font-semibold text-edo-warning">1件</span></div>
              <div><span className="text-muted-foreground">在庫反映: </span><span className="font-num font-semibold text-edo-success">完了</span></div>
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => { setStep(0); setFile(null); }}>続けてインポート</Button>
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
                <th className="text-left py-2 px-4 font-medium">期間</th>
                <th className="text-right py-2 px-4 font-medium">件数</th>
                <th className="text-right py-2 px-4 font-medium">インポート日時</th>
              </tr>
            </thead>
            <tbody>
              {mockHistory.map((h) => (
                <tr key={h.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="py-2 px-4"><FileText className="w-3.5 h-3.5 inline mr-2 text-muted-foreground" />{h.filename}</td>
                  <td className="py-2 px-4 font-num text-muted-foreground">{h.period}</td>
                  <td className="py-2 px-4 text-right font-num">{h.records}</td>
                  <td className="py-2 px-4 text-right font-num text-muted-foreground">{h.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default CsvImport;
