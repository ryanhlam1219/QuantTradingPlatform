import { Page } from "../../App";

interface Props {
  currentPage: Page;
  onNavigate: (p: Page) => void;
}

const NAV_SECTIONS = [
  {
    label: "Markets",
    items: [
      { id: "dashboard"  as Page, label: "Dashboard",    icon: "⬡" },
    ],
  },
  {
    label: "Discovery",
    items: [
      { id: "screener"   as Page, label: "Screener",     icon: "⊡" },
      { id: "research"   as Page, label: "Research",     icon: "◎" },
      { id: "portfolio"  as Page, label: "Portfolio",    icon: "◈" },
    ],
  },
  {
    label: "Trading",
    items: [
      { id: "algorithms"  as Page, label: "Algorithms",      icon: "∿" },
      { id: "backtest"    as Page, label: "Backtest",         icon: "⊿" },
      { id: "autotrader"  as Page, label: "AutoTrader",       icon: "⟳" },
      { id: "risk"        as Page, label: "Risk Management",  icon: "⚖" },
      { id: "trading"     as Page, label: "Live Trading",     icon: "⟡" },
    ],
  },
  {
    label: "Help",
    items: [
      { id: "guide"      as Page, label: "User Guide",   icon: "?" },
    ],
  },
];

export function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">◈</span>
        <span className="brand-name">QUANT<em>EDGE</em></span>
      </div>
      <nav className="sidebar-nav">
        {NAV_SECTIONS.map(section => (
          <div key={section.label} className="nav-section">
            <div className="nav-section-label">{section.label}</div>
            {section.items.map(item => (
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
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="paper-badge">PAPER TRADING</div>
        <div className="version-label">v1.1.0</div>
      </div>
    </aside>
  );
}
