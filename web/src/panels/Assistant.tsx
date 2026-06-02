import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Talks to the pi assistant sidecar over WebSocket (/assistant, proxied to :7843).
// Protocol (JSONL): client -> {type:"prompt", text}; server -> {type:"token"|"tool"|"end", ...}
type Msg = { role: "user" | "assistant" | "tool"; text: string; tool?: string; args?: any };

// Friendly labels + icons for tool calls so they read as actions, not jargon.
const TOOL_META: Record<string, { icon: string; label: string }> = {
  lookup_molecule: { icon: "🔎", label: "Looking up" },
  generate_analogs: { icon: "⚗️", label: "Generating analogs" },
  score_molecule: { icon: "📊", label: "Scoring molecule" },
  dock_dataset: { icon: "🎯", label: "Docking library" },
  load_molecule: { icon: "🧪", label: "Loading molecule" },
  load_protein: { icon: "🧬", label: "Loading protein" },
  open_module: { icon: "🪟", label: "Opening panel" },
  read: { icon: "📄", label: "Reading data" },
};
function toolView(name?: string, args?: any) {
  const meta = (name && TOOL_META[name]) || { icon: "⚙️", label: name ?? "tool" };
  const detail = args && Object.keys(args).length ? Object.values(args).join(", ") : "";
  return { icon: meta.icon, label: meta.label, detail };
}

// Module-level so the conversation survives the panel being closed/reopened
// (dockview unmounts the component, but the transcript persists here).
let CHAT_HISTORY: Msg[] = [];

// Recommended quick actions shown when the chat is empty (click to run).
const SUGGESTIONS = [
  "build caffeine",
  "load protein 7WC5",
  "generate 50 tryptamine analogs",
  "dock the analogs against 7WC5 and rank",
];

export function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>(CHAT_HISTORY);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let closed = false;
    const connect = () => {
      // dev: proxied via :5173; packaged: talk to the assistant sidecar directly.
      const DEV = location.port === "5173";
      const url = DEV
        ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/assistant`
        : "ws://127.0.0.1:7843";
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) setTimeout(connect, 1500);
      };
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data);
        // These three are side-effects of tool calls; the visible tool card is
        // rendered by the generic "tool" (tool_execution_start) event, so here we
        // only perform the UI side-effect — no extra message (avoids duplicates).
        if (e.type === "open_module") {
          window.dispatchEvent(new CustomEvent("dimitri:open-module", { detail: e.id }));
          return;
        }
        if (e.type === "load_molecule") {
          window.dispatchEvent(
            new CustomEvent("dimitri:load-molecule", { detail: { smiles: e.smiles, name: e.name } })
          );
          return;
        }
        if (e.type === "load_protein") {
          window.dispatchEvent(new CustomEvent("dimitri:load-protein", { detail: { pdbId: e.pdb_id } }));
          return;
        }
        setMsgs((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (e.type === "token") {
            // pure update — replace the last message object (mutating it would
            // double tokens under React StrictMode's double-invoked updaters)
            if (last?.role === "assistant") next[next.length - 1] = { ...last, text: last.text + e.delta };
            else next.push({ role: "assistant", text: e.delta });
          } else if (e.type === "tool") {
            next.push({ role: "tool", text: "", tool: e.name, args: e.args });
          }
          CHAT_HISTORY = next;
          return next;
        });
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [msgs]);

  const sendText = (raw: string) => {
    const text = raw.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMsgs((p) => {
      const next: Msg[] = [...p, { role: "user", text }];
      CHAT_HISTORY = next;
      return next;
    });
    wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    setInput("");
  };
  const send = () => sendText(input);

  const clearChat = () => {
    CHAT_HISTORY = [];
    setMsgs([]);
  };

  return (
    <div className="panel assistant">
      <div className="panel-toolbar chat-header">
        <span className="chat-title">
          <span className={`chat-dot ${connected ? "on" : ""}`} />
          Assistant
          {!connected && <span style={{ color: "var(--muted)" }}> — connecting…</span>}
        </span>
        {msgs.length > 0 && (
          <button className="chat-clear" onClick={clearChat} title="Clear conversation">
            Clear
          </button>
        )}
      </div>
      <div className="log chat-log" ref={logRef}>
        {msgs.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-title">What can I help you design?</div>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-suggestion" onClick={() => sendText(s)} disabled={!connected}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.role === "tool") {
            const t = toolView(m.tool, m.args);
            return (
              <div key={i} className="chat-tool">
                <span className="chat-tool-icon">{t.icon}</span>
                <span className="chat-tool-label">{t.label}</span>
                {t.detail && <span className="chat-tool-detail">{t.detail}</span>}
              </div>
            );
          }
          return (
            <div key={i} className={`chat-row ${m.role}`}>
              <div className={`chat-bubble ${m.role}`}>
                {m.role === "assistant" ? (
                  m.text ? (
                    <div className="md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="chat-typing">…</span>
                  )
                ) : (
                  m.text
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="composer chat-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask Dimitri…"
        />
        <button className="chat-send" onClick={send} disabled={!connected || !input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
