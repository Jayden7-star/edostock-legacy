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

        // Set session
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
