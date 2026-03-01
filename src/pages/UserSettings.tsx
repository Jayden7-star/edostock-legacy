import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const mockUsers = [
  { id: 1, name: "飯田 太郎", email: "admin@edoichi.jp", role: "ADMIN", lastLogin: "2026/03/01 09:30" },
  { id: 2, name: "鈴木 花子", email: "suzuki@edoichi.jp", role: "STAFF", lastLogin: "2026/02/28 15:45" },
  { id: 3, name: "田中 一郎", email: "tanaka@edoichi.jp", role: "STAFF", lastLogin: "2026/02/25 11:20" },
];

const UserSettings = () => {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{mockUsers.length}名のユーザー</p>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4" /> ユーザー追加
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {mockUsers.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass-card-hover p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                {u.role === "ADMIN" ? <Shield className="w-5 h-5 text-primary" /> : <User className="w-5 h-5 text-muted-foreground" />}
              </div>
              <Badge variant="outline" className={u.role === "ADMIN" ? "text-primary border-primary/30 text-xs" : "text-xs"}>
                {u.role === "ADMIN" ? "管理者" : "スタッフ"}
              </Badge>
            </div>
            <h3 className="font-semibold">{u.name}</h3>
            <p className="text-sm text-muted-foreground mb-3">{u.email}</p>
            <p className="text-xs text-muted-foreground">最終ログイン: <span className="font-num">{u.lastLogin}</span></p>
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="outline" className="flex-1 text-xs h-8 gap-1"><Pencil className="w-3 h-3" /> 編集</Button>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:text-destructive border-destructive/30"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </motion.div>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader><DialogTitle>ユーザーを追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>名前</Label><Input className="bg-secondary/50 border-border/50 h-11" /></div>
            <div className="space-y-2"><Label>メールアドレス</Label><Input type="email" className="bg-secondary/50 border-border/50 h-11" /></div>
            <div className="space-y-2"><Label>パスワード</Label><Input type="password" className="bg-secondary/50 border-border/50 h-11" /></div>
            <div className="space-y-2">
              <Label>権限</Label>
              <Select defaultValue="STAFF">
                <SelectTrigger className="bg-secondary/50 border-border/50 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">管理者（全操作可）</SelectItem>
                  <SelectItem value="STAFF">スタッフ（閲覧のみ）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>キャンセル</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={() => setModalOpen(false)}>追加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserSettings;
