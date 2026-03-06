import { useState, useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";

const AppLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setUser(data.user);
        } else {
          navigate("/login");
        }
        setLoading(false);
      })
      .catch(() => {
        navigate("/login");
        setLoading(false);
      });
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full"
        />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <motion.div
        animate={{ marginLeft: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="min-h-screen flex flex-col"
      >
        <AppHeader user={user} />
        <main className="flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
      </motion.div>
    </div>
  );
};

export default AppLayout;
