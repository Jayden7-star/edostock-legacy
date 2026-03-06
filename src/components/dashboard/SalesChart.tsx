import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const defaultData = [
  { month: "4月", sales: 4259114 },
  { month: "5月", sales: 4523000 },
  { month: "6月", sales: 3980000 },
  { month: "7月", sales: 3456000 },
  { month: "8月", sales: 3210000 },
  { month: "9月", sales: 3780000 },
  { month: "10月", sales: 4120000 },
  { month: "11月", sales: 4890000 },
  { month: "12月", sales: 11630736 },
  { month: "1月", sales: 3520000 },
  { month: "2月", sales: 3180000 },
  { month: "3月", sales: 4350000 },
];

const formatYen = (value: number) => {
  if (value >= 10000000) return `${(value / 10000000).toFixed(0)}千万`;
  if (value >= 10000) return `${(value / 10000).toFixed(0)}万`;
  return value.toLocaleString();
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-card px-4 py-3 text-sm">
        <p className="text-muted-foreground mb-1">{label}</p>
        <p className="font-num font-semibold text-foreground">
          ¥{payload[0].value.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

interface SalesChartProps {
  data?: { month: string; sales: number }[];
}

const SalesChart = ({ data }: SalesChartProps) => {
  const chartData = data && data.length > 0 ? data : defaultData;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="glass-card p-5 lg:p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-semibold">月別売上推移</h3>
        <span className="text-xs text-muted-foreground">過去12ヶ月</span>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(348, 78%, 58%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 20%, 20%)" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }}
              tickFormatter={formatYen}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="hsl(348, 78%, 58%)"
              strokeWidth={2.5}
              fill="url(#salesGradient)"
              dot={false}
              activeDot={{ r: 5, fill: "hsl(348, 78%, 58%)", stroke: "hsl(228, 25%, 12%)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default SalesChart;
