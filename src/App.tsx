import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Inventory from "./pages/Inventory";
import CsvImport from "./pages/CsvImport";
import Alerts from "./pages/Alerts";
import Stocktake from "./pages/Stocktake";
import AbcAnalysis from "./pages/AbcAnalysis";
import SeasonalAnalysis from "./pages/SeasonalAnalysis";
import Forecast from "./pages/Forecast";
import Recommendations from "./pages/Recommendations";
import ProductSettings from "./pages/ProductSettings";
import UserSettings from "./pages/UserSettings";
import SmaregiSettings from "./pages/SmaregiSettings";
import OptimalStock from "./pages/OptimalStock";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/import" element={<CsvImport />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/stocktake" element={<Stocktake />} />
            <Route path="/analytics/abc" element={<AbcAnalysis />} />
            <Route path="/analytics/seasonal" element={<SeasonalAnalysis />} />
            <Route path="/analytics/forecast" element={<Forecast />} />
            <Route path="/analytics/recommendations" element={<Recommendations />} />
            <Route path="/optimal-stock" element={<OptimalStock />} />
            <Route path="/settings/products" element={<ProductSettings />} />
            <Route path="/settings/users" element={<UserSettings />} />
            <Route path="/settings/smaregi" element={<SmaregiSettings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
