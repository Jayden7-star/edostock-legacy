import express from "express";
import session from "express-session";
import cors from "cors";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { authRouter } from "./auth";
import { analyticsRouter } from "./analytics";
import { productsRouter } from "./products";
import { inventoryRouter } from "./inventory";
import { csvRouter } from "./csv";
import { stocktakesRouter } from "./stocktakes";
import { purchaseImportRouter } from "./purchase-import";
import { smaregiRouter, syncSmaregiData } from "./smaregi";
import cron from "node-cron";

export const prisma = new PrismaClient();

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

// リバースプロキシ対応（Render.com など）
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// Middleware
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3001",
];
app.use(
    cors({
        origin: (origin, callback) => {
            // 本番では同一オリジン（サーバーが静的ファイルを配信）なので origin は undefined になる
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
    })
);
app.use(express.json({ limit: "50mb" }));
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret-key",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: "lax",
        },
    })
);

// Auth middleware
export function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!(req.session as any).userId) {
        return res.status(401).json({ error: "認証が必要です" });
    }
    next();
}

export function requireAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    if (!(req.session as any).userId) {
        return res.status(401).json({ error: "認証が必要です" });
    }
    if ((req.session as any).role !== "ADMIN") {
        return res.status(403).json({ error: "管理者権限が必要です" });
    }
    next();
}

// Routes
app.use("/api/auth", authRouter);
app.use("/api/analytics", requireAuth, analyticsRouter);
app.use("/api/products", requireAuth, productsRouter);
app.use("/api/inventory", requireAuth, inventoryRouter);
app.use("/api/csv", requireAdmin, csvRouter);
app.use("/api/stocktakes", requireAuth, stocktakesRouter);
app.use("/api/purchase-import", requireAdmin, purchaseImportRouter);
app.use("/api/smaregi", requireAdmin, smaregiRouter);

// Health check
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});

// 本番環境: dist/ の静的ファイルを配信（APIルートより後に追加）
if (process.env.NODE_ENV === "production") {
    const distPath = path.resolve(__dirname, "../dist");
    app.use(express.static(distPath));
    app.get("*splat", (req, res) => {
        if (!req.path.startsWith("/api")) {
            res.sendFile(path.join(distPath, "index.html"));
        }
    });
}

app.listen(PORT, () => {
    console.log(`🚀 EdoStock API サーバー起動: http://localhost:${PORT}`);

    // 日次自動同期: 毎日 AM 3:00 に前日の販売データを同期
    cron.schedule("0 3 * * *", async () => {
        console.log("[CRON] スマレジ日次同期を開始...");
        try {
            const config = await prisma.smaregiConfig.findFirst();
            if (!config || !config.syncEnabled) {
                console.log("[CRON] 自動同期は無効です。スキップします。");
                return;
            }
            const result = await syncSmaregiData();
            console.log(`[CRON] 同期完了: ${result.message}`);
        } catch (error: any) {
            console.error(`[CRON] 同期失敗: ${error.message}`);
        }
    });
    console.log("⏰ 日次同期 cron ジョブ登録済み (毎日 03:00)");
});
