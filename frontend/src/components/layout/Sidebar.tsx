import { Page } from "../../App";

interface Props {
  currentPage: Page;
  onNavigate: (p: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard",  label: "Dashboard",   icon: "⬡" },
  { id: "backtest",   label: "Backtest",     icon: "◈" },
  { id: "algorithms", label: "Algorithms",   icon: "◎" },
  { id: "trading",    label: "Live Trading", icon: "⟡" },
  { id: "guide",      label: "User Guide",   icon: "?" },
];

export function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">◈</span>
        <span className="brand-name">QUANT<em>EDGE</em></span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {currentPage === item.id && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="paper-badge">PAPER TRADING</div>
        <div className="version-label">v1.0.0</div>
      </div>
    </aside>
  );
}
