import { useState, useEffect } from "react";
import { api } from "../../services/api";

interface OllamaHealth {
  status: "online" | "offline" | "error" | "checking";
  url?: string;
  active_model?: string;
  model_loaded?: boolean;
  available_models?: string[];
  auto_start?: boolean;
  error?: string;
  fix?: string;
}

export function OllamaStatus() {
  const [health, setHealth] = useState<OllamaHealth>({ status: "checking" });
  const [expanded, setExpanded] = useState(false);

  const check = async () => {
    setHealth(h => ({ ...h, status: "checking" }));
    try {
      const r = await api.ollamaStatus();
      setHealth(r);
    } catch (e: any) {
      setHealth({ status: "offline", error: e.message });
    }
  };

  useEffect(() => { check(); }, []);

  const { status, model_loaded, active_model, auto_start, available_models, error, fix } = health;

  if (status === "checking") {
    return (
      <div className="ollama-status checking">
        <span className="ollama-dot" />
        <span>Checking Ollama…</span>
      </div>
    );
  }

  if (status === "online" && model_loaded) {
    return (
      <div className="ollama-status online" onClick={() => setExpanded(e => !e)} style={{ cursor: "pointer" }}>
        <span className="ollama-dot online" />
        <span>Ollama · {active_model}</span>
        {auto_start && <span className="ollama-tag">auto-started</span>}
        {expanded && (
          <div className="ollama-detail">
            Models: {available_models?.join(", ") || "none"}
            <button className="btn-secondary-sm" style={{ marginLeft: 8 }} onClick={e => { e.stopPropagation(); check(); }}>
              Refresh
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === "online" && !model_loaded) {
    return (
      <div className="ollama-status warn">
        <span className="ollama-dot warn" />
        <span>Ollama running, but model <code>{active_model}</code> not loaded</span>
        <span className="ollama-hint">Run: <code>ollama pull {active_model}</code></span>
        <button className="btn-secondary-sm" onClick={check}>Retry</button>
      </div>
    );
  }

  // Offline
  return (
    <div className="ollama-status offline">
      <span className="ollama-dot offline" />
      <span>Ollama offline — AI features unavailable</span>
      <span className="ollama-hint">
        {fix || "Install from ollama.com, then run: ollama serve"}
      </span>
      <button className="btn-secondary-sm" onClick={check}>Retry</button>
    </div>
  );
}
