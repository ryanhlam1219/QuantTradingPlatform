import { useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { BacktestPage } from "./pages/BacktestPage";
import { AlgorithmsPage } from "./pages/AlgorithmsPage";
import { TradingPage } from "./pages/TradingPage";
import { GuidePage } from "./pages/GuidePage";
import { ScreenerPage } from "./pages/ScreenerPage";
import { ResearchPage } from "./pages/ResearchPage";
import { PortfolioBuilderPage } from "./pages/PortfolioBuilderPage";
import { AutoTraderPage } from "./pages/AutoTraderPage";
import { RiskManagementPage } from "./pages/RiskManagementPage";
import { ExchangeComparisonPage } from "./pages/ExchangeComparisonPage";

export type Page =
  | "dashboard" | "backtest" | "algorithms" | "trading" | "guide"
  | "screener"  | "research" | "portfolio" | "autotrader" | "risk" | "exchanges";

/**
 * Pages that should stay mounted once first visited (CSS-hidden when inactive).
 * This means their internal React state is never lost on navigation.
 * localStorage persistence (via usePersistentState) handles page refresh.
 */
const KEEP_ALIVE_PAGES = new Set<Page>(["screener", "research", "portfolio", "autotrader", "exchanges"]);

// Map of page names to their route paths
const PAGE_ROUTES: Record<Page, string> = {
  "dashboard": "/",
  "backtest": "/backtest",
  "algorithms": "/algorithms",
  "trading": "/trading",
  "guide": "/guide",
  "screener": "/screener",
  "research": "/research",
  "portfolio": "/portfolio",
  "autotrader": "/autotrader",
  "risk": "/risk",
  "exchanges": "/exchanges",
};

// Inner component that uses useNavigate hook
function AppContent() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState<Set<Page>>(new Set(["dashboard"]));

  const [pendingResearchSymbols, setPendingResearchSymbols] = useState<string[]>([]);
  const [pendingPortfolioItems,  setPendingPortfolioItems]  = useState<
    { symbol: string; strategy: string; current_price: number }[]
  >([]);
  const [pendingAutoTraderSymbols, setPendingAutoTraderSymbols] = useState<string[]>([]);

  const handleNavigate = useCallback((page: Page) => {
    if (KEEP_ALIVE_PAGES.has(page)) {
      setMounted(prev => new Set([...prev, page]));
    }
    navigate(PAGE_ROUTES[page]);
  }, [navigate]);

  const handleAddToResearch = useCallback((symbols: string[]) => {
    setPendingResearchSymbols(prev => {
      const merged = [...prev];
      symbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    handleNavigate("research");
  }, [handleNavigate]);

  const handleSendToPortfolio = useCallback(
    (pair: { symbol: string; strategy: string; current_price: number }) => {
      setPendingPortfolioItems(prev => {
        const exists = prev.some(p => p.symbol === pair.symbol && p.strategy === pair.strategy);
        return exists ? prev : [...prev, pair];
      });
      handleNavigate("portfolio");
    },
    [handleNavigate],
  );

  const handleAddToAutoTrader = useCallback((symbols: string[]) => {
    setPendingAutoTraderSymbols(prev => {
      const merged = [...prev];
      symbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    handleNavigate("autotrader");
  }, [handleNavigate]);

  return (
    <div className="app-shell">
      <Sidebar currentPage="dashboard" onNavigate={handleNavigate} />

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/algorithms" element={<AlgorithmsPage />} />
          <Route path="/trading" element={<TradingPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/risk" element={<RiskManagementPage />} />

          {/* Keep-alive: Screener */}
          <Route
            path="/screener"
            element={
              mounted.has("screener") ? (
                <ScreenerPage
                  onAddToResearch={handleAddToResearch}
                  onAddToAutoTrader={handleAddToAutoTrader}
                />
              ) : null
            }
          />

          {/* Keep-alive: Research */}
          <Route
            path="/research"
            element={
              mounted.has("research") ? (
                <ResearchPage
                  pendingSymbols={pendingResearchSymbols}
                  onPendingConsumed={() => setPendingResearchSymbols([])}
                  onAddToPortfolio={(symbol, strategy, price) =>
                    handleSendToPortfolio({ symbol, strategy, current_price: price })
                  }
                />
              ) : null
            }
          />

          {/* Keep-alive: Portfolio Builder */}
          <Route
            path="/portfolio"
            element={
              mounted.has("portfolio") ? (
                <PortfolioBuilderPage
                  pendingItems={pendingPortfolioItems}
                  onPendingConsumed={() => setPendingPortfolioItems([])}
                />
              ) : null
            }
          />

          {/* Keep-alive: AutoTrader */}
          <Route
            path="/autotrader"
            element={
              mounted.has("autotrader") ? (
                <AutoTraderPage
                  pendingSymbols={pendingAutoTraderSymbols}
                  onPendingConsumed={() => setPendingAutoTraderSymbols([])}
                />
              ) : null
            }
          />

          {/* Keep-alive: Exchange Comparison */}
          <Route
            path="/exchanges"
            element={
              mounted.has("exchanges") ? (
                <ExchangeComparisonPage />
              ) : null
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
