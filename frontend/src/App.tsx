import { useState, useCallback } from "react";
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

export type Page =
  | "dashboard" | "backtest" | "algorithms" | "trading" | "guide"
  | "screener"  | "research" | "portfolio" | "autotrader" | "risk";

/**
 * Pages that should stay mounted once first visited (CSS-hidden when inactive).
 * This means their internal React state is never lost on navigation.
 * localStorage persistence (via usePersistentState) handles page refresh.
 */
const KEEP_ALIVE_PAGES = new Set<Page>(["screener", "research", "portfolio", "autotrader"]);

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  // Track which keep-alive pages have been mounted at least once.
  // We only render a keep-alive page after its first visit, then keep it.
  const [mounted, setMounted] = useState<Set<Page>>(new Set(["dashboard"]));

  // ── Cross-page "pending" queues ─────────────────────────────────────────
  // Instead of re-initializing the target page with props (which would reset
  // its state), we pass "pending" additions. The target page consumes them
  // via useEffect and then calls the "onConsumed" callback to clear them.

  const [pendingResearchSymbols, setPendingResearchSymbols] = useState<string[]>([]);
  const [pendingPortfolioItems,  setPendingPortfolioItems]  = useState<
    { symbol: string; strategy: string; current_price: number }[]
  >([]);
  const [pendingAutoTraderSymbols, setPendingAutoTraderSymbols] = useState<string[]>([]);

  // Navigate to a page, ensuring keep-alive pages are mounted
  const navigate = useCallback((page: Page) => {
    if (KEEP_ALIVE_PAGES.has(page)) {
      setMounted(prev => new Set([...prev, page]));
    }
    setCurrentPage(page);
  }, []);

  // Add symbols to Research queue and navigate there
  const handleAddToResearch = useCallback((symbols: string[]) => {
    setPendingResearchSymbols(prev => {
      const merged = [...prev];
      symbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    navigate("research");
  }, [navigate]);

  // Add a pair to Portfolio Builder and navigate there
  const handleSendToPortfolio = useCallback(
    (pair: { symbol: string; strategy: string; current_price: number }) => {
      setPendingPortfolioItems(prev => {
        const exists = prev.some(p => p.symbol === pair.symbol && p.strategy === pair.strategy);
        return exists ? prev : [...prev, pair];
      });
      navigate("portfolio");
    },
    [navigate],
  );

  // Add symbols to AutoTrader queue and navigate there
  const handleAddToAutoTrader = useCallback((symbols: string[]) => {
    setPendingAutoTraderSymbols(prev => {
      const merged = [...prev];
      symbols.forEach(s => { if (!merged.includes(s)) merged.push(s); });
      return merged;
    });
    navigate("autotrader");
  }, [navigate]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const isActive = (page: Page) => currentPage === page;

  // Normal (non-keep-alive) page rendering
  const normalPage = () => {
    switch (currentPage) {
      case "dashboard":  return <Dashboard />;
      case "backtest":   return <BacktestPage />;
      case "algorithms": return <AlgorithmsPage />;
      case "trading":    return <TradingPage />;
      case "guide":      return <GuidePage />;
      case "risk":       return <RiskManagementPage />;
      default:           return null;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={navigate} />

      <main className="main-content">

        {/* ── Normal pages (unmounted when inactive) ── */}
        {!KEEP_ALIVE_PAGES.has(currentPage) && normalPage()}

        {/* ── Keep-alive: Screener ── */}
        {mounted.has("screener") && (
          <div style={{ display: isActive("screener") ? "block" : "none" }}>
            <ScreenerPage
              onAddToResearch={handleAddToResearch}
              onAddToAutoTrader={handleAddToAutoTrader}
            />
          </div>
        )}

        {/* ── Keep-alive: Research ── */}
        {mounted.has("research") && (
          <div style={{ display: isActive("research") ? "block" : "none" }}>
            <ResearchPage
              pendingSymbols={pendingResearchSymbols}
              onPendingConsumed={() => setPendingResearchSymbols([])}
              onAddToPortfolio={(symbol, strategy, price) =>
                handleSendToPortfolio({ symbol, strategy, current_price: price })
              }
            />
          </div>
        )}

        {/* ── Keep-alive: Portfolio Builder ── */}
        {mounted.has("portfolio") && (
          <div style={{ display: isActive("portfolio") ? "block" : "none" }}>
            <PortfolioBuilderPage
              pendingItems={pendingPortfolioItems}
              onPendingConsumed={() => setPendingPortfolioItems([])}
            />
          </div>
        )}

        {/* ── Keep-alive: AutoTrader ── */}
        {mounted.has("autotrader") && (
          <div style={{ display: isActive("autotrader") ? "block" : "none" }}>
            <AutoTraderPage
              pendingSymbols={pendingAutoTraderSymbols}
              onPendingConsumed={() => setPendingAutoTraderSymbols([])}
            />
          </div>
        )}

      </main>
    </div>
  );
}
