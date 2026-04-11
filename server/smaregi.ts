import { Router } from "express";
import { prisma } from "./index";

export const smaregiRouter = Router();

// GET /api/smaregi/config — 現在の設定取得（clientSecretは返さない）
smaregiRouter.get("/config", async (_req, res) => {
    try {
        const config = await prisma.smaregiConfig.findFirst();
        if (!config) {
            return res.json({ configured: false });
        }
        res.json({
            configured: true,
            contractId: config.contractId,
            clientId: config.clientId,
            clientSecret: config.clientSecret ? "••••••••" : "",
            syncEnabled: config.syncEnabled,
            lastSyncAt: config.lastSyncAt,
            hasToken: !!config.accessToken,
            tokenExpiry: config.tokenExpiry,
        });
    } catch (error) {
        console.error("Smaregi config fetch error:", error);
        res.status(500).json({ error: "設定の取得に失敗しました" });
    }
});

// POST /api/smaregi/config — API設定の保存（upsert）
smaregiRouter.post("/config", async (req, res) => {
    try {
        const { contractId, clientId, clientSecret, syncEnabled } = req.body;

        if (!contractId || !clientId || !clientSecret) {
            return res.status(400).json({ error: "契約ID、クライアントID、クライアントシークレットは必須です" });
        }

        const existing = await prisma.smaregiConfig.findFirst();

        if (existing) {
            const updated = await prisma.smaregiConfig.update({
                where: { id: existing.id },
                data: {
                    contractId,
                    clientId,
                    clientSecret,
                    syncEnabled: syncEnabled ?? existing.syncEnabled,
                    // Reset tokens when credentials change
                    ...(clientId !== existing.clientId || clientSecret !== existing.clientSecret
                        ? { accessToken: null, refreshToken: null, tokenExpiry: null }
                        : {}),
                },
            });
            res.json({
                success: true,
                message: "設定を更新しました",
                configured: true,
                syncEnabled: updated.syncEnabled,
            });
        } else {
            const created = await prisma.smaregiConfig.create({
                data: { contractId, clientId, clientSecret, syncEnabled: syncEnabled ?? false },
            });
            res.json({
                success: true,
                message: "設定を保存しました",
                configured: true,
                syncEnabled: created.syncEnabled,
            });
        }
    } catch (error) {
        console.error("Smaregi config save error:", error);
        res.status(500).json({ error: "設定の保存に失敗しました" });
    }
});

// POST /api/smaregi/test — 接続テスト（トークン取得を試みる）
smaregiRouter.post("/test", async (_req, res) => {
    try {
        const config = await prisma.smaregiConfig.findFirst();
        if (!config) {
            return res.status(400).json({ success: false, error: "スマレジAPIの設定がありません。先に設定を保存してください。" });
        }

        // Attempt to get access token from Smaregi API
        const tokenUrl = `https://id.smaregi.jp/app/${config.contractId}/token`;
        const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

        const tokenResponse = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${credentials}`,
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                scope: `pos.products:read pos.transactions:read pos.stores:read`,
            }),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error("Smaregi token error:", errorData);

            // Log the failed attempt
            await prisma.smaregiSyncLog.create({
                data: {
                    status: "FAILED",
                    errorMessage: `接続テスト失敗: HTTP ${tokenResponse.status}`,
                },
            });

            return res.json({
                success: false,
                error: `スマレジAPIへの接続に失敗しました (HTTP ${tokenResponse.status})。契約ID・クライアントID・シークレットを確認してください。`,
            });
        }

        const tokenData = await tokenResponse.json() as { access_token: string; expires_in: number; refresh_token?: string };

        // Save the token
        const tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
        await prisma.smaregiConfig.update({
            where: { id: config.id },
            data: {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || null,
                tokenExpiry,
            },
        });

        // Log the successful test
        await prisma.smaregiSyncLog.create({
            data: {
                status: "SUCCESS",
                errorMessage: null,
            },
        });

        res.json({
            success: true,
            message: "スマレジAPIへの接続に成功しました！",
            tokenExpiry: tokenExpiry.toISOString(),
        });
    } catch (error: any) {
        console.error("Smaregi test error:", error);

        // Log the error
        await prisma.smaregiSyncLog.create({
            data: {
                status: "FAILED",
                errorMessage: `接続テストエラー: ${error.message || "不明なエラー"}`,
            },
        });

        res.status(500).json({
            success: false,
            error: `接続テストに失敗しました: ${error.message || "サーバーエラー"}`,
        });
    }
});

// GET /api/smaregi/sync-logs — 同期履歴（直近30件）
smaregiRouter.get("/sync-logs", async (_req, res) => {
    try {
        const logs = await prisma.smaregiSyncLog.findMany({
            orderBy: { syncDate: "desc" },
            take: 30,
        });
        res.json(logs);
    } catch (error) {
        console.error("Smaregi sync logs error:", error);
        res.status(500).json({ error: "同期履歴の取得に失敗しました" });
    }
});

// ==================================================
//  トークン取得/リフレッシュ
// ==================================================
async function getSmaregiToken(config: {
    id: number;
    clientId: string;
    clientSecret: string;
    accessToken: string | null;
    tokenExpiry: Date | null;
    contractId: string;
}): Promise<string> {
    // Return existing token if still valid (with 5-minute buffer)
    if (config.accessToken && config.tokenExpiry) {
        const buffer = 5 * 60 * 1000; // 5 minutes
        if (new Date(config.tokenExpiry).getTime() - buffer > Date.now()) {
            return config.accessToken;
        }
    }

    // Request new token via client credentials
    const tokenUrl = `https://id.smaregi.jp/app/${config.contractId}/token`;
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${credentials}`,
        },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "pos.products:read pos.transactions:read pos.stores:read",
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`トークン取得失敗 (HTTP ${response.status}): ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };
    const tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    await prisma.smaregiConfig.update({
        where: { id: config.id },
        data: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            tokenExpiry,
        },
    });

    return data.access_token;
}

// ==================================================
//  販売データ同期コア関数
// ==================================================
export async function syncSmaregiData(targetDate?: string): Promise<{
    success: boolean;
    recordCount: number;
    message: string;
}> {
    const config = await prisma.smaregiConfig.findFirst();
    if (!config) {
        throw new Error("スマレジAPIの設定がありません");
    }

    // Determine target date (default: yesterday)
    const date = targetDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split("T")[0];
    })();

    const syncLog = await prisma.smaregiSyncLog.create({
        data: { status: "RUNNING", syncDate: new Date(date) },
    });

    try {
        // 1. Get access token
        const token = await getSmaregiToken(config);

        // 2. Fetch transaction details from Smaregi API
        const apiBase = `https://api.smaregi.jp/${config.contractId}/pos`;
        const params = new URLSearchParams({
            "transaction_date_time_from": `${date}T00:00:00+09:00`,
            "transaction_date_time_to": `${date}T23:59:59+09:00`,
            "limit": "1000",
        });

        const txResponse = await fetch(`${apiBase}/transactions/details?${params}`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });

        if (!txResponse.ok) {
            const errorText = await txResponse.text();
            throw new Error(`販売データ取得失敗 (HTTP ${txResponse.status}): ${errorText}`);
        }

        const txData = await txResponse.json() as Array<{
            productCode: string;
            productName: string;
            quantity: string;
            price: string;
            unitPrice: string;
        }>;

        if (!Array.isArray(txData) || txData.length === 0) {
            await prisma.smaregiSyncLog.update({
                where: { id: syncLog.id },
                data: { status: "SUCCESS", recordCount: 0, errorMessage: `${date}: 販売データなし` },
            });
            await prisma.smaregiConfig.update({
                where: { id: config.id },
                data: { lastSyncAt: new Date() },
            });
            return { success: true, recordCount: 0, message: `${date}の販売データはありませんでした` };
        }

        // 3. Aggregate by product code
        const salesByProduct = new Map<string, { quantity: number; productName: string; totalSales: number }>();
        for (const detail of txData) {
            const code = detail.productCode;
            if (!code) continue;
            const qty = parseInt(detail.quantity) || 0;
            const sales = parseInt(detail.price) || 0;
            if (qty <= 0) continue; // skip returns or zero-quantity items

            const existing = salesByProduct.get(code);
            if (existing) {
                existing.quantity += qty;
                existing.totalSales += sales;
            } else {
                salesByProduct.set(code, {
                    quantity: qty,
                    productName: detail.productName || code,
                    totalSales: sales,
                });
            }
        }

        // 4. Update stock for each product
        let updatedCount = 0;
        for (const [janCode, salesData] of salesByProduct) {
            const product = await prisma.product.findUnique({ where: { janCode } });
            if (!product) continue; // Skip unregistered products

            const rawStock = product.currentStock - salesData.quantity;
            const clamped = rawStock < 0;
            const newStock = Math.max(0, rawStock);

            if (clamped) {
                console.warn(`⚠️ マイナス在庫クランプ: ${product.name} (ID:${product.id}) 計算値=${rawStock} → 0`);
            }

            const noteBase = `スマレジ同期 (${date}): ${salesData.quantity}個販売`;
            await prisma.$transaction([
                prisma.product.update({
                    where: { id: product.id },
                    data: { currentStock: newStock },
                }),
                prisma.inventoryTransaction.create({
                    data: {
                        productId: product.id,
                        type: "SMAREGI_SYNC",
                        quantity: -salesData.quantity,
                        stockAfter: newStock,
                        note: clamped ? `${noteBase} ⚠️ マイナス在庫を0にクランプ` : noteBase,
                        userId: 1, // System user
                    },
                }),
            ]);
            updatedCount++;
        }

        // 5. Log success
        await prisma.smaregiSyncLog.update({
            where: { id: syncLog.id },
            data: {
                status: "SUCCESS",
                recordCount: updatedCount,
                errorMessage: null,
            },
        });

        await prisma.smaregiConfig.update({
            where: { id: config.id },
            data: { lastSyncAt: new Date() },
        });

        return {
            success: true,
            recordCount: updatedCount,
            message: `${date}の販売データを同期しました（${updatedCount}商品更新、${txData.length}明細処理）`,
        };
    } catch (error: any) {
        console.error("Smaregi sync error:", error);

        await prisma.smaregiSyncLog.update({
            where: { id: syncLog.id },
            data: {
                status: "FAILED",
                errorMessage: error.message || "不明なエラー",
            },
        });

        throw error;
    }
}

// POST /api/smaregi/sync — 手動同期トリガー
smaregiRouter.post("/sync", async (req, res) => {
    try {
        const { date } = req.body;
        const result = await syncSmaregiData(date || undefined);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || "同期に失敗しました",
        });
    }
});
