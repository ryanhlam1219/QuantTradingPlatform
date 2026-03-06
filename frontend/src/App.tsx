import { useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { BacktestPage } from "./pages/BacktestPage";
import { AlgorithmsPage } from "./pages/AlgorithmsPage";
import { TradingPage } from "./pages/TradingPage";
import { GuidePage } from "./pages/GuidePage";

export type Page = "dashboard" | "backtest" | "algorithms" | "trading" | "guide";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  const pages: Record<Page, JSX.Element> = {
    dashboard:  <Dashboard />,
    backtest:   <BacktestPage />,
    algorithms: <AlgorithmsPage />,
    trading:    <TradingPage />,
    guide:      <GuidePage />,
  };

  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="main-content">{pages[currentPage]}</main>
    </div>
  );
}
