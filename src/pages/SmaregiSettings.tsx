import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Save, Wifi, WifiOff, Loader2, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SmaregiConfigData {
    configured: boolean;
    contractId?: string;
    clientId?: string;
    clientSecret?: string;
    syncEnabled?: boolean;
    lastSyncAt?: string | null;
    hasToken?: boolean;
    tokenExpiry?: string | null;
}

interface SyncLog {
    id: number;
    syncDate: string;
    recordCount: number;
    status: string;
    errorMessage: string | null;
    createdAt: string;
}

const SmaregiSettings = () => {
    const [contractId, setContractId] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [configured, setConfigured] = useState(false);

    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [loading, setLoading] = useState(true);

    const { toast } = useToast();

    // Fetch config
    useEffect(() => {
        fetch("/api/smaregi/config", { credentials: "include" })
            .then((r) => r.json())
            .then((data: SmaregiConfigData) => {
                if (data.configured) {
                    setContractId(data.contractId || "");
                    setClientId(data.clientId || "");
                    setClientSecret(data.clientSecret || "");
                    setSyncEnabled(data.syncEnabled || false);
                    setLastSyncAt(data.lastSyncAt || null);
                    setConfigured(true);
                }
            })
            .catch(() => toast({ title: "エラー", description: "設定の取得に失敗しました", variant: "destructive" }))
            .finally(() => setLoading(false));
    }, [toast]);

    // Fetch sync logs
    const fetchLogs = useCallback(() => {
        fetch("/api/smaregi/sync-logs", { credentials: "include" })
            .then((r) => r.json())
            .then(setLogs)
            .catch(() => { });
    }, []);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // Save config
    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/smaregi/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ contractId, clientId, clientSecret, syncEnabled }),
            });
            const data = await res.json();
            if (res.ok) {
                toast({ title: "保存完了", description: data.message });
                setConfigured(true);
                setTestResult(null);
            } else {
                toast({ title: "エラー", description: data.error, variant: "destructive" });
            }
        } catch {
            toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    // Test connection
    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch("/api/smaregi/test", {
                method: "POST",
                credentials: "include",
            });
            const data = await res.json();
            setTestResult({ success: data.success, message: data.message || data.error });
            if (data.success) {
                toast({ title: "接続成功", description: data.message });
            } else {
                toast({ title: "接続失敗", description: data.error, variant: "destructive" });
            }
        } catch {
            setTestResult({ success: false, message: "サーバーに接続できません" });
            toast({ title: "接続エラー", description: "サーバーに接続できません", variant: "destructive" });
        } finally {
            setTesting(false);
            fetchLogs();
        }
    };

    // Manual sync
    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await fetch("/api/smaregi/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.success) {
                toast({ title: "同期完了", description: data.message });
                setLastSyncAt(new Date().toISOString());
            } else {
                toast({ title: "同期失敗", description: data.error, variant: "destructive" });
            }
        } catch {
            toast({ title: "接続エラー", description: "同期に失敗しました", variant: "destructive" });
        } finally {
            setSyncing(false);
            fetchLogs();
        }
    };

    // Toggle sync enabled (auto-save)
    const handleToggleSync = async (checked: boolean) => {
        setSyncEnabled(checked);
        try {
            await fetch("/api/smaregi/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ contractId, clientId, clientSecret, syncEnabled: checked }),
            });
            toast({ title: checked ? "自動同期を有効化" : "自動同期を無効化" });
        } catch {
            setSyncEnabled(!checked);
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="glass-card p-5 h-32 shimmer" />
                ))}
            </div>
        );
    }

    const statusBadge = (status: string) => {
        const styles: Record<string, string> = {
            SUCCESS: "bg-edo-success/15 text-edo-success border-edo-success/30",
            FAILED: "bg-primary/15 text-primary border-primary/30",
            RUNNING: "bg-edo-info/15 text-edo-info border-edo-info/30",
            PARTIAL: "bg-edo-warning/15 text-edo-warning border-edo-warning/30",
        };
        const labels: Record<string, string> = {
            SUCCESS: "成功", FAILED: "失敗", RUNNING: "実行中", PARTIAL: "一部成功",
        };
        return (
            <Badge variant="outline" className={cn("text-xs", styles[status] || "")}>
                {labels[status] || status}
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            {/* 1. 接続設定カード */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                        <Wifi className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold">API接続設定</h3>
                        <p className="text-xs text-muted-foreground">スマレジAPIとの連携設定</p>
                    </div>
                </div>

                <div className="grid gap-4 max-w-lg">
                    <div className="space-y-2">
                        <Label className="text-sm">契約ID</Label>
                        <Input
                            value={contractId}
                            onChange={(e) => setContractId(e.target.value)}
                            placeholder="例: sb-xxxxxxxx"
                            className="bg-secondary/50 border-border/50 h-11"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-sm">クライアントID</Label>
                        <Input
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="例: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            className="bg-secondary/50 border-border/50 h-11"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-sm">クライアントシークレット</Label>
                        <Input
                            type="password"
                            value={clientSecret}
                            onChange={(e) => setClientSecret(e.target.value)}
                            placeholder={configured ? "変更する場合のみ入力" : "シークレットを入力"}
                            className="bg-secondary/50 border-border/50 h-11"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3 mt-5">
                    <Button
                        variant="outline"
                        onClick={handleTest}
                        disabled={testing || !contractId || !clientId}
                        className="gap-2"
                    >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                        接続テスト
                    </Button>
                    <Button
                        className="bg-primary hover:bg-primary/90 gap-2"
                        onClick={handleSave}
                        disabled={saving || !contractId || !clientId || !clientSecret}
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        保存
                    </Button>
                    {testResult && (
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-xs ml-2",
                                testResult.success
                                    ? "bg-edo-success/15 text-edo-success border-edo-success/30"
                                    : "bg-primary/15 text-primary border-primary/30"
                            )}
                        >
                            {testResult.success ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
                            {testResult.success ? "接続成功" : "接続失敗"}
                        </Badge>
                    )}
                </div>
            </motion.div>

            {/* 2. 同期設定カード */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold">同期設定</h3>
                        <p className="text-xs text-muted-foreground">販売データの自動同期（毎日 AM 3:00）</p>
                    </div>
                </div>

                <div className="flex items-center justify-between max-w-lg">
                    <div className="flex items-center gap-3">
                        <Switch
                            checked={syncEnabled}
                            onCheckedChange={handleToggleSync}
                            disabled={!configured}
                        />
                        <Label className="text-sm">
                            自動同期 {syncEnabled ? "ON" : "OFF"}
                        </Label>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleSync}
                        disabled={syncing || !configured}
                        className="gap-2"
                    >
                        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        今すぐ同期
                    </Button>
                </div>

                {lastSyncAt && (
                    <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span>最終同期: <span className="font-num font-semibold">{new Date(lastSyncAt).toLocaleString("ja-JP")}</span></span>
                    </div>
                )}
                {!configured && (
                    <p className="text-xs text-muted-foreground mt-3">
                        <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                        先にAPI接続設定を保存してください
                    </p>
                )}
            </motion.div>

            {/* 3. 同期履歴テーブル */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card overflow-hidden">
                <div className="p-5 pb-3">
                    <h3 className="text-base font-semibold">同期履歴</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border/50 text-muted-foreground">
                                <th className="text-left py-2 px-5 font-medium">同期日時</th>
                                <th className="text-right py-2 px-4 font-medium">件数</th>
                                <th className="text-center py-2 px-4 font-medium">ステータス</th>
                                <th className="text-left py-2 px-4 font-medium">エラー</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <tr key={log.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                                    <td className="py-2.5 px-5 font-num">
                                        {new Date(log.syncDate).toLocaleString("ja-JP")}
                                    </td>
                                    <td className="py-2.5 px-4 text-right font-num">{log.recordCount}</td>
                                    <td className="py-2.5 px-4 text-center">{statusBadge(log.status)}</td>
                                    <td className="py-2.5 px-4 text-xs text-muted-foreground max-w-[200px] truncate">
                                        {log.errorMessage || "—"}
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                                        <RefreshCw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                        <p>まだ同期履歴がありません</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </motion.div>
        </div>
    );
};

export default SmaregiSettings;
