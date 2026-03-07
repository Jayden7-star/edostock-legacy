import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type User = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  createdAt: string;
};

const emptyForm = { name: "", email: "", password: "", role: "STAFF" };

const UserSettings = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/auth/users", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data);
    } catch {
      toast({ title: "エラー", description: "ユーザー一覧の取得に失敗しました", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openAdd = () => {
    setEditTarget(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditTarget(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.email || (!editTarget && !form.password)) {
      toast({ title: "入力エラー", description: "名前・メール・パスワードを入力してください", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const url = editTarget ? `/api/auth/users/${editTarget.id}` : "/api/auth/users";
      const method = editTarget ? "PUT" : "POST";
      const body: any = { name: form.name, email: form.email, role: form.role };
      if (form.password) body.password = form.password;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: editTarget ? "更新しました" : "追加しました", description: `${form.name}のアカウントを${editTarget ? "更新" : "作成"}しました` });
      setModalOpen(false);
      fetchUsers();
    } catch (e: any) {
      toast({ title: "エラー", description: e.message || "操作に失敗しました", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`${u.name}を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/auth/users/${u.id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "削除しました", description: `${u.name}のアカウントを削除しました` });
      fetchUsers();
    } catch (e: any) {
      toast({ title: "エラー", description: e.message || "削除に失敗しました", variant: "destructive" });
    }
  };

  if (loading) return <div className="text-center py-10 text-muted-foreground">読み込み中...</div>;

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length}名のユーザー</p>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={openAdd}>
          <Plus className="w-4 h-4" /> ユーザー追加
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {users.map((u, i) => (
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
            <p className="text-xs text-muted-foreground">登録日: <span className="font-num">{new Date(u.createdAt).toLocaleDateString("ja-JP")}</span></p>
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="outline" className="flex-1 text-xs h-8 gap-1" onClick={() => openEdit(u)}>
                <Pencil className="w-3 h-3" /> 編集
              </Button>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:text-destructive border-destructive/30" onClick={() => handleDelete(u)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader><DialogTitle>{editTarget ? "ユーザーを編集" : "ユーザーを追加"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>名前</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-secondary/50 border-border/50 h-11" />
            </div>
            <div className="space-y-2">
              <Label>メールアドレス</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="bg-secondary/50 border-border/50 h-11" />
            </div>
            <div className="space-y-2">
              <Label>{editTarget ? "パスワード（変更する場合のみ）" : "パスワード"}</Label>
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="bg-secondary/50 border-border/50 h-11" />
            </div>
            <div className="space-y-2">
              <Label>権限</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
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
            <Button className="bg-primary hover:bg-primary/90" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "処理中..." : editTarget ? "更新" : "追加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserSettings;
