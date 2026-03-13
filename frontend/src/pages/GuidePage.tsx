import { useState } from "react";

const SECTIONS = [
  { id: "start",       label: "Getting Started" },
  { id: "dashboard",   label: "Dashboard" },
  { id: "screener",    label: "Screener" },
  { id: "research",    label: "Research" },
  { id: "portfolio",   label: "Portfolio Builder" },
  { id: "autotrader",  label: "AutoTrader" },
  { id: "risk",        label: "Risk Management" },
  { id: "backtest",    label: "Backtesting" },
  { id: "algos",       label: "Algorithms" },
  { id: "trading",     label: "Live Trading" },
  { id: "workflow",    label: "Recommended Workflow" },
  { id: "faq",         label: "FAQ" },
];

export function GuidePage() {
  const [active, setActive] = useState("start");

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">User Guide</h1>
          <p className="page-sub">Everything you need to go from zero to a live automated portfolio</p>
        </div>
      </header>

      <div className="guide-layout">
        <nav className="guide-toc">
          {SECTIONS.map(s => (
            <button key={s.id}
              className={`guide-toc-item ${active === s.id ? "active" : ""}`}
              onClick={() => setActive(s.id)}
            >{s.label}</button>
          ))}
        </nav>

        <div className="guide-content">

          {active === "start" && (
            <Section title="Getting Started">
              <P>QuantEdge is a full-stack algorithmic trading platform. It lets you:</P>
              <Ul items={[
                "Discover and screen assets using price, momentum, and volatility filters",
                "Get AI-powered research on any stock or crypto using a local Ollama LLM",
                "Backtest 5 algorithmic strategies against years of historical data",
                "Build Sharpe-weighted portfolios with AI review and one-click execution",
                "Configure and fine-tune strategy parameters interactively",
                "Execute strategy signals in real time via a paper trading account",
                "Monitor positions, orders, and account P&L live",
              ]} />
              <Callout type="info" title="Paper Trading by Default">
                All trading executes against a <strong>simulated Alpaca paper account</strong>. No real capital is at risk. This is the safe way to learn, test, and validate strategies.
              </Callout>
              <H3>Prerequisites</H3>
              <P>You need a free Alpaca account. Sign up at alpaca.markets, copy your Paper Trading API key and secret, and set them in <code>backend/.env</code>:</P>
              <Code>{`ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_FEED=iex`}</Code>
              <H3>AI Features (Optional)</H3>
              <P>The Screener, Research, and Portfolio Builder all use a local Ollama LLM for AI-powered analysis. To enable this:</P>
              <Code>{`# Install Ollama from https://ollama.com, then:
ollama serve          # start the server
ollama pull llama3    # download the model (one-time, ~4GB)`}</Code>
              <P>QuantEdge will attempt to auto-start Ollama if it's not running. All AI features degrade gracefully — if Ollama is offline you still get full price stats, backtests, and news.</P>
              <H3>Starting the Platform</H3>
              <Code>{`./start.sh`}</Code>
              <P>Frontend opens at <code>http://localhost:3000</code> · API docs at <code>http://localhost:8000/docs</code></P>
            </Section>
          )}

          {active === "dashboard" && (
            <Section title="Dashboard">
              <P>The Dashboard is your real-time market overview — a candlestick chart for any symbol, with signal overlays and quick statistics.</P>
              <H3>Timeframe Buttons</H3>
              <Table
                headers={["Button", "Candle Size", "Typical Lookback"]}
                rows={[
                  ["1H", "1-hour candles", "Last 30 days"],
                  ["4H", "4-hour candles", "Last 90 days"],
                  ["1D", "Daily candles", "Last year"],
                  ["3Y / 5Y / MAX", "Daily candles", "Up to 2016 (IEX limit)"],
                  ["1W", "Weekly candles", "Since 2016"],
                ]}
              />
              <Callout type="info" title="IEX Data Feed">
                Free Alpaca accounts use the IEX feed: 15-minute delay, intraday data limited to 30 days, daily/weekly data back to 2016.
              </Callout>
              <H3>Signal Feed</H3>
              <P>The panel on the right shows the latest BUY/SELL/HOLD signal for each strategy on the active symbol. These update every time you change the symbol or timeframe.</P>
            </Section>
          )}

          {active === "screener" && (
            <Section title="Screener">
              <P>The Screener scans a watchlist of symbols, computes technical metrics for each, and lets you filter to find the best candidates for further research. This is your starting point for discovering new trades.</P>

              <H3>Step-by-Step</H3>
              <Ol items={[
                "Choose a watchlist: S&P 100, Top Crypto, Growth Tech, or ETFs.",
                "Set optional filters: minimum 30-day return, maximum volatility, or market condition.",
                "Add custom symbols in the tag input if you want to scan something not in the watchlists.",
                "Click ▶ Scan. The platform fetches 120 days of daily data for every symbol concurrently.",
                "Results appear sorted by trend score. Click column headers to re-sort.",
                "Use the header checkbox to Select All results at once, or click individual row checkboxes.",
                "With rows selected, use 'Research Selected →' to send to Research, or '⟳ AutoTrader →' to jump straight to the AutoTrader funnel.",
                "Or click 'Research' / '⟳ AutoTrader' on any single row to act on it immediately.",
              ]} />

              <H3>Screener Metrics Explained</H3>
              <Table
                headers={["Metric", "What it measures", "Useful when..."]}
                rows={[
                  ["Trend Score", "% the current price is above/below its 20-day MA", "Looking for strong momentum"],
                  ["30d / 90d Return", "Price change over 30 or 90 calendar days", "Finding recent outperformers"],
                  ["Volatility", "Annualised standard deviation of daily returns", "Matching risk tolerance to strategy"],
                  ["RSI (14)", "Relative Strength Index — overbought > 70, oversold < 30", "Finding mean-reversion entries"],
                  ["Volume Rank", "Today's volume ÷ 20-day average volume", "Confirming trend strength"],
                  ["Market Condition", "Classified as trending_up / trending_down / ranging / volatile", "Matching strategy type to market"],
                ]}
              />

              <H3>AI Asset Suggestions</H3>
              <P>The left sidebar has an AI suggestions panel. Click <strong>\u2726 Suggest New Assets</strong> and Ollama will recommend 5 symbols that complement your current screen results, each with a rationale and a best-fit strategy. Each suggestion card has two buttons: <strong>Research →</strong> (deep analysis) and <strong>⟳ AutoTrader</strong> (add directly to the AutoTrader funnel).</P>
              <Callout type="tip" title="Best Practice">
                Use the Screener to narrow a watchlist of 40+ symbols down to 5–8 strong candidates. Select all with the header checkbox and send them to AutoTrader for a fully AI-driven allocation in one click.
              </Callout>
            </Section>
          )}

          {active === "research" && (
            <Section title="Research">
              <P>The Research page runs a full analysis pipeline on each asset you add: live price statistics, 1-year backtests across all 5 strategies, recent news headlines, and an Ollama AI recommendation.</P>

              <H3>Adding Symbols</H3>
              <Ul items={[
                "Type a symbol in the 'Add symbol…' input and press Enter or click +",
                "Send symbols from the Screener using 'Research →' or 'Research N selected →'",
                "Add assets from Portfolio Builder suggestions",
              ]} />

              <H3>The Research Queue</H3>
              <P>The left panel is your queue — a scrollable list of every symbol you've added. Click a symbol to view its results. Each item shows the AI recommendation (BUY/SELL/HOLD) and the best-fit strategy once analysis is complete. The Analyse button fetches fresh data on demand.</P>

              <H3>What Each Analysis Contains</H3>
              <Table
                headers={["Panel", "What you see"]}
                rows={[
                  ["AI Recommendation Banner", "BUY / SELL / HOLD with confidence score, market condition, and trend direction"],
                  ["Price Statistics", "Current price, 30d/90d returns, volatility, RSI, position vs 20/50-day MAs, volume rank"],
                  ["AI Reasoning", "Ollama's analysis: why it recommends this action, key risk, best strategy fit, support/resistance levels"],
                  ["Strategy Backtests", "All 5 strategies run on 1 year of data — sorted by Sharpe. The AI-selected best strategy is highlighted with ★"],
                  ["Recent News", "Up to 10 recent headlines from Alpaca's news feed for the symbol"],
                  ["Add to Portfolio CTA", "One-click button to send the symbol + recommended strategy to the Portfolio Builder"],
                ]}
              />

              <H3>Sending to Portfolio Builder</H3>
              <P>Click <strong>Add to Portfolio Builder →</strong> at the bottom of any research result. This pre-loads the symbol and its best-fit strategy into the Portfolio Builder page. You can also click <strong>Use →</strong> on any individual strategy row to use a different strategy than the AI recommendation.</P>

              <Callout type="tip" title="Ollama Offline?">
                If Ollama isn't running, the page shows a warning banner and still displays all price stats and backtest scores. The AI reasoning and recommendation panels are skipped. Start Ollama with <code>ollama serve</code> and click Analyse again to get the full analysis.
              </Callout>
            </Section>
          )}

          {active === "portfolio" && (
            <Section title="Portfolio Builder">
              <P>The Portfolio Builder lets you construct a multi-asset algorithmic portfolio, compute a <strong>Sharpe-weighted capital allocation</strong>, get an AI review of the plan, and then execute all positions with a single click.</P>

              <Callout type="info" title="The Big Picture">
                This is the end of the pipeline: Screener → Research → Portfolio Builder → Execute. By this point you've already identified strong candidates and chosen the best-fit strategy for each.
              </Callout>

              <H3>Step 1 — Add Asset-Strategy Pairs</H3>
              <P>The left panel is your portfolio configuration. Add pairs by either:</P>
              <Ul items={[
                "Clicking 'Add to Portfolio Builder →' on any Research result (auto-fills symbol, strategy, and price)",
                "Typing directly in the Symbol / Strategy / Price inputs and clicking Add",
              ]} />
              <P>Each row in the list shows the symbol, strategy, and current price. Click × to remove any pair.</P>

              <H3>Step 2 — Set Capital and Build</H3>
              <P>Enter your total capital (e.g. $10,000), decide whether to include an AI review, and click <strong>▶ Build Portfolio Plan</strong>. The platform will:</P>
              <Ol items={[
                "Run a 1-year backtest for each asset-strategy pair to calculate its Sharpe Ratio",
                "Compute Sharpe-weighted capital allocation — assets with higher Sharpe ratios get more capital",
                "Apply a 5% floor and 40% ceiling so no position is too small to matter or too large to concentrate risk",
                "Ask Ollama to review the final plan and give an overall score + GO / CAUTION / NO_GO rating",
              ]} />

              <H3>Understanding the Allocation</H3>
              <P>The allocation formula is:</P>
              <Code>{`weight_i = sharpe_i / sum(all_sharpes)
then clamp each weight to [5%, 40%] and renormalise`}</Code>
              <P>This means the capital is distributed proportionally to each asset's risk-adjusted return. A strategy that produced a Sharpe of 2.0 gets roughly twice as much capital as one with Sharpe 1.0, subject to the floor and ceiling.</P>
              <Table
                headers={["Constraint", "Value", "Why"]}
                rows={[
                  ["Minimum weight", "5%", "Ensures every position is meaningful (no dust positions)"],
                  ["Maximum weight", "40%", "Prevents over-concentration in one asset"],
                  ["Sharpe floor", "0.01", "Ensures assets with negative Sharpe still get the minimum weight rather than being excluded entirely"],
                ]}
              />

              <H3>Reading the Plan Results</H3>
              <P>After building, you'll see:</P>
              <Ul items={[
                "An allocation bar chart showing each position's weight visually",
                "A table with: symbol, strategy, Sharpe ratio, allocation %, capital ($), and estimated shares",
                "The AI review panel with overall score (0–10), a GO/CAUTION/NO_GO verdict, diversification commentary, and specific improvement suggestions",
              ]} />

              <H3>Step 3 — Approve and Execute</H3>
              <P>Review the plan carefully. When you're ready, click <strong>✓ Approve & Execute All</strong>. The platform fires all market buy orders simultaneously via Alpaca. Each order is logged with its result (filled, failed, or partial).</P>
              <Callout type="warning" title="Before You Execute">
                Check that your Alpaca account has enough buying power for the total capital amount. Market orders execute at the current bid/ask — your actual fill prices will differ slightly from the prices shown in the plan.
              </Callout>
              <P>You can also use <strong>Dry Run</strong> mode (toggle in the Execute section) to simulate the execution without placing real orders — useful for verifying the plan before committing.</P>

              <H3>After Execution</H3>
              <P>Once executed, head to the <strong>Live Trading</strong> page to monitor your open positions, see unrealized P&L, and execute SELL signals when your strategies call for it.</P>

              <Callout type="tip" title="Rebuilding the Portfolio">
                You can rebuild the portfolio plan at any time without executing — useful for comparing scenarios (e.g. what if I added NVDA? what if I used Grid Trading instead of RSI?). Only click Execute when you're confident in the plan.
              </Callout>
            </Section>
          )}

          {active === "autotrader" && (
            <Section title="AutoTrader">
              <P>AutoTrader is the fully automated end-to-end trading funnel. You supply a list of symbols and a total capital budget — the platform researches every asset and lets the LLM decide how much capital to allocate to each, based on backtest quality, momentum, and AI confidence. It has three tabs: <strong>Manual</strong> (one-shot analysis), <strong>Cycles</strong> (scheduled automated runs), and <strong>Backtest</strong> (walk-forward simulation).</P>

              <Callout type="info" title="AutoTrader vs Portfolio Builder">
                Portfolio Builder requires you to manually pick a strategy per asset; AutoTrader picks the strategy for you and also allocates capital automatically. Use AutoTrader when you want the fastest path from idea to orders placed.
              </Callout>

              <H3>Manual Tab — One-Shot Analysis</H3>
              <Ol items={[
                "Add symbols: type them into the input box (comma- or space-separated) and click + Add, or press Enter.",
                "Click ⟡ Load Positions to import every symbol you currently hold on Alpaca — great for re-analysing your existing portfolio.",
                "Or navigate to the Screener, select results or AI suggestions, and click ⟳ AutoTrader → to pre-populate the list.",
                "Enter your Total Capital ($) and click ▶ Analyze.",
                "The platform researches every symbol concurrently: fetches price data, runs 1-year backtests for all 5 strategies, pulls recent news, and sends everything to Ollama.",
                "Ollama decides how to split your capital across the symbols, with per-symbol reasoning visible in the table.",
                "Review the allocation table: strategy, price, weight %, capital, shares, Sharpe, 1-year return, max drawdown, AI signal, and reasoning.",
                "Override shares in any row, or uncheck rows to exclude symbols.",
                "Click Execute (or Dry Run to simulate) to place all market orders simultaneously.",
              ]} />

              <H3>How AI Allocation Works</H3>
              <P>After researching all symbols, Ollama receives a structured summary for each asset and assigns a capital weight. It considers:</P>
              <Ul items={[
                "Sharpe ratio and total return from the best 1-year backtest",
                "30d and 90d price momentum",
                "AI recommendation (BUY / SELL / HOLD) and confidence score",
                "Risk notes and trend direction",
              ]} />
              <P>Weights are normalised to sum to 100%. A 5% floor and 40% ceiling are enforced. If Ollama is offline the system falls back to Sharpe-weighted allocation — the Method badge in the results table shows which was used.</P>

              <H3>Cycles Tab — Scheduled Automated Runs</H3>
              <P>A Cycle is a saved AutoTrader configuration that runs on a schedule. Each cycle re-researches its symbols at the configured interval and can optionally execute trades automatically.</P>
              <Table
                headers={["Field", "Description"]}
                rows={[
                  ["Name", "A label for this cycle (e.g. \"Weekly Tech Review\")"],
                  ["Symbols", "The asset list analysed on every run"],
                  ["Capital ($)", "Total capital budget per run"],
                  ["Interval (min)", "How often the cycle fires — e.g. 60 = hourly, 1440 = daily"],
                  ["Auto Execute", "If enabled, trades are placed automatically without human review. Use with caution."],
                  ["Dry Run", "Simulate orders without placing them (safe default, ON by default)"],
                  ["Max Cycles", "Stop after N runs (leave blank to run indefinitely)"],
                  ["Stop Loss %", "Halt the cycle if the portfolio drops more than X% from its starting value"],
                  ["Daily Loss Limit %", "Halt if the portfolio loses more than X% within a single calendar day"],
                  ["Stop At", "Schedule a hard stop date/time"],
                ]}
              />
              <P>After creating a cycle, click <strong>Start</strong> to activate it. The status badge changes from idle to running. Click <strong>Stop</strong> to pause it. Expand a cycle row and click <strong>View Logs</strong> to see a real-time tail of every run — allocation method, symbols processed, execution results, and any errors.</P>
              <Callout type="warning" title="Auto Execute">
                With Auto Execute ON, the cycle places real market orders without human confirmation on every run. Only enable after thorough paper-trading validation. Always configure a Stop Loss % and Daily Loss Limit % so the cycle halts automatically if performance deteriorates.
              </Callout>

              <H3>Backtest Tab — Walk-Forward Simulation</H3>
              <P>The Backtest tab simulates an AutoTrader cycle over historical data using a <strong>walk-forward</strong> methodology. At each rebalance point the allocator only sees data available up to that date — there is zero look-ahead bias.</P>
              <Table
                headers={["Parameter", "Range", "What it controls"]}
                rows={[
                  ["Capital ($)", "≥ $100", "Starting portfolio value"],
                  ["Rebalance every (days)", "1 – 90", "How often the portfolio is rebalanced — mirrors the Cycle interval"],
                  ["Simulation window (days)", "30 – 1825", "Length of the historical replay (up to 5 years)"],
                  ["Strategy lookback (days)", "10 – 365", "Rolling window used per rebalance to evaluate and rank strategies"],
                ]}
              />
              <P>Results include:</P>
              <Ul items={[
                "Equity curve chart — your strategy vs equal-weight buy-and-hold benchmark",
                "Aggregate metrics: total return, annualised return, Sharpe ratio, max drawdown, win rate",
                "Benchmark metrics: same stats for a passive buy-and-hold of the same symbols",
                "Rebalance event log: date, chosen strategy per symbol, Sharpe at that rebalance, and portfolio value",
              ]} />
              <Callout type="tip" title="Choosing a Simulation Window">
                Use 365 days (1 year) for a quick check. Use 1095–1825 days (3–5 years) to capture full market cycles including bull runs, corrections, and flat periods. Alpaca IEX data goes back to 2016, so windows up to ~3500 days are available in practice.
              </Callout>

              <H3>Importing from Screener</H3>
              <P>Every row in the Screener results table has a ⟳ AutoTrader button. AI suggestion cards in the sidebar also have an AutoTrader button. The Screener selection action bar shows ⟳ AutoTrader → when rows are checked, sending all selected symbols at once. Symbols arrive pre-filled in AutoTrader — just set capital and click Analyze.</P>

              <Callout type="warning" title="Before You Execute">
                AutoTrader fires real market orders against your Alpaca account. In paper mode (default) no real money moves, but verify share counts make sense for your capital before clicking Execute on a live account.
              </Callout>
            </Section>
          )}

          {active === "risk" && (
            <Section title="Risk Management">
              <P>The Risk Management page provides two tools: a <strong>Position Sizer</strong> for calculating how many shares to buy on any single trade, and a <strong>Portfolio Risk Report</strong> for analysing an existing multi-asset portfolio.</P>

              <H3>Position Sizer Tab</H3>
              <P>Enter your account details and get an instant recommendation for how many shares to buy while keeping your downside within a specific dollar amount.</P>
              <Table
                headers={["Input", "Description"]}
                rows={[
                  ["Capital ($)", "Your total account equity"],
                  ["Entry Price", "The price at which you plan to buy"],
                  ["Stop Loss %", "How far the price must fall before you exit (e.g. 5 = 5% below entry)"],
                  ["Risk Per Trade %", "The % of capital you are willing to lose on this trade (default 2%)"],
                  ["Win Rate (optional)", "Your historical win rate — enables Kelly Criterion sizing"],
                  ["Avg Win / Avg Loss (optional)", "Average profit on winning trades vs average loss on losers"],
                ]}
              />
              <P>The sizer returns two calculations:</P>
              <Ul items={[
                "Fixed-Fractional: the standard method — risk a fixed % of capital per trade",
                "Kelly Criterion (if win/loss data provided): the mathematically optimal fraction based on your historical edge. Half-Kelly is applied automatically and capped at 50% for safety.",
              ]} />
              <Callout type="tip" title="Starting Point">
                2% risk per trade is the industry-standard default for discretionary traders. For algorithmic strategies, start even lower (0.5–1%) until you have validated live performance.
              </Callout>

              <H3>Portfolio Risk Report Tab</H3>
              <P>Enter your current holdings (symbol, quantity, entry price) and the platform fetches historical price data to compute a full risk report.</P>
              <Table
                headers={["Metric", "What it means"]}
                rows={[
                  ["Portfolio Value", "Mark-to-market value at current prices"],
                  ["Unrealized P&L", "Total gain or loss from your entry prices"],
                  ["Historical VaR (95%)", "The daily loss you should not exceed on 95% of trading days"],
                  ["CVaR / Expected Shortfall", "Average loss in the worst 5% of days — always ≥ VaR"],
                  ["Max Drawdown", "Worst peak-to-trough loss in the lookback period"],
                  ["Annualised Return", "Compounded return extrapolated to one year"],
                  ["Sharpe Ratio", "Return per unit of annualised volatility"],
                  ["Sector Exposure", "Breakdown of portfolio value by sector (Technology, Crypto, ETF, etc.)"],
                  ["Correlation Matrix", "Pairwise correlation between every holding — red (≥ 0.85) means highly correlated positions that move together"],
                ]}
              />
              <Callout type="info" title="Using the Correlation Matrix">
                High correlation (red) between two positions means they will likely rise and fall together — you get less diversification benefit. Consider replacing one with an uncorrelated asset. The Portfolio Builder automatically drops one of any pair with correlation above 0.85 during its de-duplication pass.
              </Callout>
            </Section>
          )}

          {active === "backtest" && (
            <Section title="Backtesting">
              <P>Backtesting simulates a strategy against historical data to measure how it would have performed before risking any capital.</P>
              <H3>Three Modes</H3>
              <Ul items={[
                "Single Strategy — test one strategy on one symbol over a date range",
                "Compare All — run all 5 strategies on the same symbol simultaneously and rank by Sharpe",
                "Portfolio — run one strategy across multiple symbols with equal capital split",
              ]} />
              <H3>Key Metrics</H3>
              <Table
                headers={["Metric", "What it means", "Good value"]}
                rows={[
                  ["Total Return", "Overall % gain/loss over the period", "Positive, > benchmark"],
                  ["Sharpe Ratio", "Return per unit of risk (volatility)", "> 1.0 is solid, > 2.0 is excellent"],
                  ["Max Drawdown", "Worst peak-to-trough loss", "Less than -20% is generally acceptable"],
                  ["Win Rate", "% of trades that closed at a profit", "> 50%, but also check profit factor"],
                  ["Profit Factor", "Gross profits ÷ gross losses", "> 1.5 is good, > 2.0 is strong"],
                  ["Sortino Ratio", "Like Sharpe but only penalises downside volatility", "> 1.5"],
                ]}
              />
              <Callout type="warning" title="Backtesting Limitations">
                Backtests model simplified conditions: long-only, one position at a time, market orders. Real trading has slippage, partial fills, liquidity constraints, and taxes. A good backtest is a necessary — but not sufficient — condition for a good live strategy.
              </Callout>
            </Section>
          )}

          {active === "algos" && (
            <Section title="Algorithms">
              <P>The Algorithms page lets you explore, understand, and configure each strategy before deploying it.</P>
              <H3>Four Tabs Per Strategy</H3>
              <Ul items={[
                "Overview — plain-English explanation, analogy, how it works step-by-step, and a real example",
                "Visualisation — interactive chart showing how the strategy generates signals on simulated price data",
                "Parameters — sliders to adjust every setting with descriptions and impact explanations",
                "Tuning Tips — specific advice for different market conditions",
              ]} />
              <H3>Parameters are Shared Across Pages</H3>
              <P>Parameters set in the Algorithms tab are automatically used when you run a backtest or execute a signal from Live Trading. Click ↺ Reset to restore defaults.</P>
              <H3>Strategy Quick Reference</H3>
              <Table
                headers={["Strategy", "Market Type", "Core Idea"]}
                rows={[
                  ["MA Crossover", "Trending", "Buy when fast MA crosses above slow MA (Golden Cross)"],
                  ["RSI", "Range-bound", "Buy when oversold (RSI < 30), sell when overbought (RSI > 70)"],
                  ["Bollinger Bands", "Volatile / mean-reverting", "Buy when price bounces off the lower band"],
                  ["MACD", "Momentum", "Buy when MACD line crosses above signal line"],
                  ["Grid Trading", "Sideways / oscillating", "Buy at fixed dips, sell at fixed rises — profit from oscillation"],
                ]}
              />
            </Section>
          )}

          {active === "trading" && (
            <Section title="Live Trading">
              <P>The Live Trading page connects to your Alpaca paper account to execute orders and monitor your portfolio in real time.</P>
              <Callout type="warning" title="Paper Trading Only">
                All orders execute against a simulated paper account. No real money is involved.
              </Callout>
              <H3>Account Strip</H3>
              <P>The strip at the top shows Portfolio Value, Cash, Buying Power, Unrealized P&L, Day P&L, and Session Return — updated every 30 seconds.</P>
              <H3>Algo Execution Workflow</H3>
              <Ol items={[
                "Select a symbol and strategy",
                "Set the quantity (number of shares/units)",
                "Click ▶ Execute Signal",
                "The platform fetches the latest signal — BUY places a market buy, SELL closes the position",
                "Execution is logged to the Strategy Execution Log below",
              ]} />
              <H3>Manual Orders</H3>
              <P>The Manual Orders tab lets you place ad-hoc market orders without a strategy signal — useful for manually closing positions or testing order flow.</P>
              <H3>Positions, Orders, and Fills</H3>
              <Ul items={[
                "Open Positions — current holdings with avg entry, current price, unrealized P&L. Click Close to flatten.",
                "Open Orders — pending orders. Click Cancel to cancel.",
                "Recent Fills — last 30 completed orders with fill price and timestamp.",
              ]} />
            </Section>
          )}

          {active === "workflow" && (
            <Section title="Recommended Workflow">
              <P>The full QuantEdge workflow in 9 steps, from idea to live portfolio:</P>
              <Ol items={[
                "Dashboard — Get oriented. Pick a symbol, look at 1D and 1W charts. Is the market trending, ranging, or volatile? This shapes which strategies to consider.",
                "Screener — Scan a watchlist. Filter by trend score, volatility, and market condition. Use the header checkbox to select all results, then send them directly to AutoTrader or Research.",
                "Option A (Manual): Research — Send candidates to Research for deep analysis. Review price stats, AI recommendations, and backtest scores. Focus on Sharpe > 1.",
                "Option A continued: Portfolio Builder — Add your chosen (asset, strategy) pairs. Set your capital. Click Build to see the Sharpe-weighted allocation and AI review.",
                "Option B (Automated): AutoTrader — Select screened symbols and click ⟳ AutoTrader →. Enter capital, click Analyze. The LLM researches everything and allocates capital automatically.",
                "Review the plan — Check allocations, override any share counts, deselect positions you don't want. Click Execute (AutoTrader) or Approve & Execute All (Portfolio Builder).",
                "Monitor — Check Live Trading daily. Watch Unrealized P&L and Day P&L. The platform does not auto-exit positions — you must execute SELL signals manually.",
                "Re-research — Once a week or after major price moves, go back to Research or AutoTrader and re-analyse your holdings. Update your strategy if conditions have changed.",
                "Review performance — Use the Portfolio Backtest mode in Backtesting to compare your actual holdings vs the historical strategy performance.",
              ]} />
              <Callout type="warning" title="Important Reminder">
                Past backtest performance never guarantees future results. Always validate with paper trading before considering live capital. Start small, scale slowly.
              </Callout>
            </Section>
          )}

          {active === "faq" && (
            <Section title="FAQ">
              <FAQ q="What is AutoTrader and how is it different from Portfolio Builder?" a="AutoTrader is a fully automated funnel: you supply symbols + capital, the LLM researches every asset and decides how to allocate capital across them. Portfolio Builder is manual: you pick a specific strategy per asset and get a Sharpe-weighted allocation. Use AutoTrader for speed; use Portfolio Builder when you want precise control over strategy selection." />
              <FAQ q="How does AI capital allocation work in AutoTrader?" a="After researching all symbols, Ollama receives a data summary for each: backtest Sharpe, momentum, max drawdown, AI recommendation, and confidence. It assigns a weight to each symbol (min 5%, max 40%) with written reasoning. Weights are normalised to sum to 100%. If Ollama is offline, the fallback is Sharpe-weighted allocation — the Method badge shows which was used." />
              <FAQ q="Can I add symbols from my Alpaca positions to AutoTrader?" a="Yes. On the AutoTrader page, click Load Positions. This fetches every symbol you currently hold on Alpaca and pre-fills the symbol list. You can then run a fresh AI analysis on your existing holdings." />
              <FAQ q="How do I send Screener results to AutoTrader?" a="Check rows in the Screener results table (use the header checkbox to select all), then click AutoTrader in the action bar. You can also click AutoTrader on any individual row, or on any AI suggestion card in the sidebar. Symbols arrive pre-loaded in AutoTrader." />
              <FAQ q="What are AutoTrader Cycles?" a="A Cycle is a saved AutoTrader run configuration that executes on a schedule. You configure the symbols, capital, interval (e.g. every 60 minutes), and safety limits (stop loss %, daily loss limit %, max runs, stop-at date). Each run re-researches your symbols and optionally executes trades automatically. Cycle logs are streamed in real time in the Cycles tab." />
              <FAQ q="Is it safe to enable Auto Execute on a Cycle?" a="Auto Execute places real market orders without human confirmation on every run. Only enable it after thorough paper-trading validation. Always configure a Stop Loss % and Daily Loss Limit % so the cycle halts automatically if performance deteriorates. By default, Dry Run is ON — the cycle simulates orders until you explicitly turn it off." />
              <FAQ q="What is the walk-forward backtest vs a regular backtest?" a="A regular backtest runs a fixed strategy over a fixed date range — it can overfit to that period. The walk-forward simulation rebalances at regular intervals, and at each rebalance it only uses data available up to that point (no look-ahead bias). This is a more realistic simulation of how an AutoTrader Cycle would have actually performed historically." />
              <FAQ q="How long a simulation window can I use?" a="Up to 1825 days (5 years). The Alpaca IEX data feed goes back to 2016, so windows of 3–5 years are practical for most symbols. Longer windows capture full market cycles but take more time to compute." />
              <FAQ q="What does the Risk Management page do?" a="It has two tools: Position Sizer (fixed-fractional and Kelly Criterion sizing for a single trade) and Portfolio Risk Report (VaR, CVaR, Sharpe, max drawdown, sector exposure, and correlation matrix for your current holdings). Use it before executing any plan to understand your maximum possible loss." />
              <FAQ q="What is VaR and CVaR?" a="Value at Risk (VaR) is the daily loss threshold you should not exceed with 95% probability. CVaR (Conditional VaR / Expected Shortfall) is the average loss on the worst 5% of days — it is always at least as large as VaR and gives a better sense of tail risk. Both are computed from historical daily returns." />
              <FAQ q="Ollama shows as offline — what do I do?" a="Install Ollama from https://ollama.com, run 'ollama serve' in a terminal, then 'ollama pull llama3' to download the model. QuantEdge will auto-detect it on the next health check. You can also use a different model — set OLLAMA_MODEL in backend/.env to any model you've pulled (e.g. mistral, qwen2.5, phi3)." />
              <FAQ q="Why does AI suggest say '404 Not Found'?" a="This means Ollama is running but the model hasn't been downloaded yet. Run: ollama pull llama3 (or whatever model is set in OLLAMA_MODEL). The 404 means Ollama is reachable but can't find the model to chat with." />
              <FAQ q="Why does the chart only show data back to 2016?" a="The Alpaca IEX free data feed begins in 2016. Upgrade to a paid Alpaca plan and set ALPACA_DATA_FEED=sip in your .env for full market data." />
              <FAQ q="Why is the Research signal HOLD?" a="HOLD means the strategy's conditions for BUY or SELL haven't been met in the current data window. Try a different strategy or check if the asset is in a flat consolidation phase." />
              <FAQ q="The Portfolio Builder shows a very low Sharpe. Is that bad?" a="Sharpe below 0 means the strategy lost money on that asset over the past year on a risk-adjusted basis. The builder still assigns the minimum 5% weight. Consider replacing that pair with a different asset or strategy." />
              <FAQ q="Can I run this against a live trading account?" a="Yes, by changing ALPACA_BASE_URL to https://api.alpaca.markets in backend/.env. Only do this after thoroughly testing with paper trading and understanding the risks involved." />
              <FAQ q="How do I add a symbol not in the screener watchlists?" a="Type it directly in the custom symbols row, or type it into the Research queue input. Any symbol tradeable on Alpaca works — use BTC/USD format for crypto." />
              <FAQ q="How does Sharpe-weighted allocation work?" a="Each asset's weight equals its Sharpe ratio divided by the sum of all Sharpes. This gives proportionally more capital to better risk-adjusted performers. A 5% floor prevents dust positions; a 40% ceiling prevents over-concentration." />
              <FAQ q="What's the difference between Portfolio Builder and Portfolio Backtest?" a="Portfolio Backtest (in the Backtest page) tests one strategy across multiple symbols historically. Portfolio Builder (in its own page) combines different strategies for different assets, computes an allocation, and executes the positions." />
              <FAQ q="Does the platform remember my work between sessions?" a="Yes. The Screener (filters + results), Research (queue + all analysis results), and Portfolio Builder (pairs, capital, plan, and validation results) all persist automatically to your browser's localStorage. Refreshing the page or closing and reopening the tab restores your session exactly as you left it." />
              <FAQ q="Why did my Screener results or Research queue disappear?" a="Data is saved per-browser in localStorage. If you opened the app in a different browser, a private/incognito window, or cleared your browser's site data, the saved state will be gone." />
            </Section>
          )}

        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="guide-section"><h2 className="guide-h2">{title}</h2>{children}</div>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="guide-h3">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="guide-p">{children}</p>;
}
function Ul({ items }: { items: string[] }) {
  return <ul className="guide-ul">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}
function Ol({ items }: { items: string[] }) {
  return <ol className="guide-ol">{items.map((item, i) => <li key={i}>{item}</li>)}</ol>;
}
function Code({ children }: { children: string }) {
  return <pre className="guide-code"><code>{children}</code></pre>;
}
function Callout({ type, title, children }: { type: "info"|"tip"|"warning"; title: string; children: React.ReactNode }) {
  const colors = { info: "var(--blue)", tip: "var(--green)", warning: "var(--orange)" };
  const icons  = { info: "ℹ", tip: "✓", warning: "⚠" };
  return (
    <div className="guide-callout" style={{ "--callout-color": colors[type] } as any}>
      <div className="guide-callout-title"><span>{icons[type]}</span>{title}</div>
      <div className="guide-callout-body">{children}</div>
    </div>
  );
}
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap guide-table-wrap">
      <table className="data-table">
        <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button className="faq-q" onClick={() => setOpen(o => !o)}>
        <span>{open ? "▾" : "▸"}</span>{q}
      </button>
      {open && <p className="faq-a">{a}</p>}
    </div>
  );
}
