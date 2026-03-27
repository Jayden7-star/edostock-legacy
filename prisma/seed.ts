import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    // Create categories
    const categories = [
        { name: "Tシャツ", displayName: "Tシャツ", isFood: false, department: "APPAREL", displayOrder: 1 },
        { name: "☆　その他雑貨", displayName: "その他雑貨", isFood: false, department: "GOODS", displayOrder: 2 },
        { name: "佃煮　自社製造", displayName: "佃煮 自社製造", isFood: true, department: "FOOD", displayOrder: 3 },
        { name: "特売", displayName: "特売", isFood: true, department: "FOOD", displayOrder: 4 },
        { name: "佃煮仕入れ商品", displayName: "佃煮 仕入れ", isFood: true, department: "FOOD", displayOrder: 5 },
        { name: "佃煮りパック", displayName: "佃煮リパック", isFood: true, department: "FOOD", displayOrder: 6 },
        { name: "菓子仕入れ商品", displayName: "菓子 仕入れ", isFood: true, department: "FOOD", displayOrder: 7 },
        { name: "煮豆仕入れ商品", displayName: "煮豆 仕入れ", isFood: true, department: "FOOD", displayOrder: 8 },
        { name: "☆　その他　仕入れ商品", displayName: "その他 仕入れ", isFood: true, department: "FOOD", displayOrder: 9 },
        { name: "混ぜご飯のもと", displayName: "混ぜご飯のもと", isFood: true, department: "FOOD", displayOrder: 10 },
        { name: "☆　その他", displayName: "その他", isFood: false, department: "GOODS", displayOrder: 11 },
    ];

    for (const cat of categories) {
        await prisma.category.upsert({
            where: { name: cat.name },
            update: {},
            create: cat,
        });
    }

    // Create users
    const adminHash = await bcrypt.hash("admin123", 10);
    const staffHash = await bcrypt.hash("staff123", 10);

    await prisma.user.upsert({
        where: { email: "admin@edoichi.com" },
        update: {},
        create: { name: "管理者", email: "admin@edoichi.com", passwordHash: adminHash, role: "ADMIN" },
    });

    await prisma.user.upsert({
        where: { email: "staff@edoichi.com" },
        update: {},
        create: { name: "スタッフ", email: "staff@edoichi.com", passwordHash: staffHash, role: "STAFF" },
    });

    console.log("✅ シードデータの投入が完了しました");
    console.log("  管理者: admin@edoichi.com / admin123");
    console.log("  スタッフ: staff@edoichi.com / staff123");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
