import { Bell, Package, TrendingUp, Percent } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import SalesChart from "@/components/dashboard/SalesChart";
import AlertList from "@/components/dashboard/AlertList";
import RecommendationBanner from "@/components/dashboard/RecommendationBanner";

const Index = () => {
  return (
    <div className="space-y-6">
      {/* KPIカード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5">
        <KpiCard
          title="発注アラート"
          value="5"
          subtitle="発注点以下の商品"
          icon={Bell}
          variant="alert"
          delay={0}
        />
        <KpiCard
          title="在庫総数"
          value="1,247"
          subtitle="150品目"
          icon={Package}
          variant="default"
          delay={0.08}
        />
        <KpiCard
          title="今月売上"
          value="¥4,350,000"
          icon={TrendingUp}
          trend={{ value: "8.2%", positive: true }}
          variant="success"
          delay={0.16}
        />
        <KpiCard
          title="粗利率"
          value="42.3%"
          icon={Percent}
          trend={{ value: "1.5%", positive: true }}
          variant="gold"
          delay={0.24}
        />
      </div>

      {/* チャート + アラート */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-5">
        <div className="xl:col-span-2">
          <SalesChart />
        </div>
        <AlertList />
      </div>

      {/* 提案バナー */}
      <RecommendationBanner />
    </div>
  );
};

export default Index;
