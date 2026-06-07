import { useEffect, useState } from "react";
import { Clock, AlertTriangle, Package, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseTimestamp } from "@/lib/datetime";

export interface HistoryProduct {
  id: number;
  name: string;
  janCode: string;
  currentStock: number;
}

interface MovementTransaction {
  id: number;
  productId: number;
  type: string;
  quantity: number;
  stockAfter: number;
  note: string | null;
  createdAt: string;
  isClamped: boolean;
  user: { id: number; name: string } | null;
  csvImport: { id: number; filename: string; csvType: string } | null;
}

interface HistoryResponse {
  product: HistoryProduct;
  transactions: MovementTransaction[];
  total: number;
  limit: number;
  offset: number;
}

interface ProductHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: HistoryProduct | null;
}

// 在庫変動の type → 日本語ラベル。type は enum ではなく自由文字列のため、
// 未知/旧データ（例: 旧 "STOCKTAKE"）は生の値をそのまま表示するフォールバックを必ず通す。
const TYPE_LABELS: Record<string, string> = {
  PURCHASE: "入庫（仕入）",
  PURCHASE_CSV: "仕入CSV",
  SALE_CSV: "売上CSV",
  SMAREGI_SYNC: "スマレジ同期",
  ADJUSTMENT: "在庫調整",
  STOCKTAKE_ADJUSTMENT: "棚卸し補正",
  STOCKTAKE: "棚卸し補正", // 旧データ向け後方互換
};

const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

const formatDiff = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

const formatDateTime = (value: string): string =>
  parseTimestamp(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const ProductHistoryDialog = ({ open, onOpenChange, product }: ProductHistoryDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    if (!open || !product) {
      // 閉じたら状態をリセットし、次に別商品を開いたとき確実に再取得させる
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/inventory/${product.id}/transactions`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: HistoryResponse) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("在庫履歴の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, product]);

  const transactions = data?.transactions ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            在庫履歴 — {product?.name ?? ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground">
            現在庫:{" "}
            <span className="font-num font-semibold text-foreground">
              {product?.currentStock ?? "—"}
            </span>
            {data && <span className="ml-3">全 {data.total} 件</span>}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && (
              <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>
            )}

            {error && !loading && (
              <p className="py-12 text-center text-sm text-primary">{error}</p>
            )}

            {!loading && !error && transactions.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">在庫変動の記録がありません</p>
              </div>
            )}

            {!loading && !error && transactions.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">日時</th>
                    <th className="text-left py-2 px-3 font-medium">種別</th>
                    <th className="text-right py-2 px-3 font-medium">増減</th>
                    <th className="text-right py-2 px-3 font-medium">在庫(後)</th>
                    <th className="text-left py-2 px-3 font-medium">備考 / ソース</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border/30 hover:bg-secondary/30 transition-colors align-top"
                    >
                      <td className="py-2 px-3 font-num whitespace-nowrap">
                        {formatDateTime(t.createdAt)}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className="text-xs border-border/50">
                          {typeLabel(t.type)}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          "py-2 px-3 text-right font-num font-semibold whitespace-nowrap",
                          t.quantity > 0
                            ? "text-edo-success"
                            : t.quantity < 0
                              ? "text-primary"
                              : "text-muted-foreground"
                        )}
                      >
                        {formatDiff(t.quantity)}
                      </td>
                      <td className="py-2 px-3 text-right font-num">{t.stockAfter}</td>
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-1">
                          {t.isClamped && (
                            <Badge className="w-fit bg-edo-warning/20 text-edo-warning border-edo-warning/40 text-[10px] px-1.5 py-0">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              在庫クランプ
                            </Badge>
                          )}
                          {t.note && <span className="text-xs text-foreground/80">{t.note}</span>}
                          {t.csvImport && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <FileText className="w-3 h-3" />
                              {t.csvImport.filename}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {t.user ? t.user.name : "—"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductHistoryDialog;
