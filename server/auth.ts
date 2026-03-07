import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "./index.js";
export const authRouter = Router();

// POST /api/auth/login
authRouter.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "メールアドレスとパスワードを入力してください" });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
        }
        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
        }
        (req.session as any).userId = user.id;
        (req.session as any).role = user.role;
        (req.session as any).name = user.name;
        (req.session as any).email = user.email;
        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
});

// GET /api/auth/session
authRouter.get("/session", (req, res) => {
    if ((req.session as any).userId) {
        res.json({
            authenticated: true,
            user: {
                id: (req.session as any).userId,
                name: (req.session as any).name,
                email: (req.session as any).email,
                role: (req.session as any).role,
            },
        });
    } else {
        res.json({ authenticated: false });
    }
});

// POST /api/auth/logout
authRouter.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "ログアウトに失敗しました" });
        }
        res.clearCookie("connect.sid");
        res.json({ success: true });
    });
});

// GET /api/auth/users - ユーザー一覧取得（管理者のみ）
authRouter.get("/users", async (req, res) => {
    try {
        if ((req.session as any).role !== "ADMIN") {
            return res.status(403).json({ error: "管理者権限が必要です" });
        }
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true, role: true, createdAt: true },
            orderBy: { createdAt: "asc" },
        });
        res.json(users);
    } catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
});

// POST /api/auth/users - ユーザー追加（管理者のみ）
authRouter.post("/users", async (req, res) => {
    try {
        if ((req.session as any).role !== "ADMIN") {
            return res.status(403).json({ error: "管理者権限が必要です" });
        }
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "名前・メール・パスワードは必須です" });
        }
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: "このメールアドレスは既に使用されています" });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, email, passwordHash, role: role || "STAFF" },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        });
        res.json(user);
    } catch (error) {
        console.error("Create user error:", error);
        res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
});

// PUT /api/auth/users/:id - ユーザー編集（管理者のみ）
authRouter.put("/users/:id", async (req, res) => {
    try {
        if ((req.session as any).role !== "ADMIN") {
            return res.status(403).json({ error: "管理者権限が必要です" });
        }
        const { id } = req.params;
        const { name, email, password, role, currentPassword } = req.body;
        const isSelf = (req.session as any).userId === parseInt(id);

        // 自分自身の編集の場合は現行パスワードを確認
        if (isSelf) {
            if (!currentPassword) {
                return res.status(400).json({ error: "現在のパスワードを入力してください" });
            }
            const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });
            if (!user) return res.status(404).json({ error: "ユーザーが見つかりません" });
            const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
            if (!isValid) {
                return res.status(401).json({ error: "現在のパスワードが正しくありません" });
            }
        }

        const data: any = {};
        if (name) data.name = name;
        if (email) data.email = email;
        if (role) data.role = role;
        if (password) data.passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data,
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        });
        res.json(user);
    } catch (error) {
        console.error("Update user error:", error);
        res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
});

// DELETE /api/auth/users/:id - ユーザー削除（管理者のみ）
authRouter.delete("/users/:id", async (req, res) => {
    try {
        if ((req.session as any).role !== "ADMIN") {
            return res.status(403).json({ error: "管理者権限が必要です" });
        }
        const { id } = req.params;
        if ((req.session as any).userId === parseInt(id)) {
            return res.status(400).json({ error: "自分自身は削除できません" });
        }
        await prisma.user.delete({ where: { id: parseInt(id) } });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
});
