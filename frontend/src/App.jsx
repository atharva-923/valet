import { useEffect, useMemo, useRef, useState } from "react";
import { fetchConfig, streamChat } from "./api";
import MarkdownBody from "./components/MarkdownBody";

const STORAGE_THREADS_KEY = "jarvis.desk.threads.v1";
const STORAGE_ACTIVE_KEY = "jarvis.desk.active.v1";
const STORAGE_THEME_KEY = "jarvis.desk.theme.v1";
const STORAGE_PROVIDER_KEY = "jarvis.desk.provider.v1";

const STARTER_PROMPTS = [
  "Stress-test an architectural decision before I commit to it.",
  "Draft a concise, polite reply declining an unnecessary meeting.",
  "Compare two trade-offs in plain terms and recommend one.",
];

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Untitled note";
  const cleaned = firstUser.content.replace(/\s+/g, " ").trim();
  return cleaned.length > 44 ? `${cleaned.slice(0, 44)}…` : cleaned;
}

function createThread() {
  return {
    id: createId(),
    title: "Untitled note",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

function loadThreads() {
  try {
    const raw = localStorage.getItem(STORAGE_THREADS_KEY);
    if (!raw) return [createThread()];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [createThread()];
  } catch {
    return [createThread()];
  }
}

function SidebarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [threads, setThreads] = useState(loadThreads);
  const [activeId, setActiveId] = useState(() => {
    return localStorage.getItem(STORAGE_ACTIVE_KEY) || "";
  });
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem(STORAGE_PROVIDER_KEY) || "";
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(STORAGE_THEME_KEY) || "paper";
  });
  const [railCollapsed, setRailCollapsed] = useState(() => {
    return typeof window !== "undefined" ? window.innerWidth <= 780 : false;
  });

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const loadBackendConfig = async () => {
    setConfigError("");
    try {
      const data = await fetchConfig();
      setConfig(data);
      setProvider((prev) => {
        const exists = data.providers.some((p) => p.id === prev);
        return exists ? prev : data.defaultProvider;
      });
    } catch (err) {
      setConfigError(err.message || "Could not reach backend server.");
    }
  };

  useEffect(() => {
    loadBackendConfig();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(STORAGE_ACTIVE_KEY, activeId);
    }
  }, [activeId]);

  useEffect(() => {
    if (provider) {
      localStorage.setItem(STORAGE_PROVIDER_KEY, provider);
    }
  }, [provider]);

  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === activeId) || threads[0];
  }, [threads, activeId]);

  useEffect(() => {
    if (activeThread && activeThread.id !== activeId) {
      setActiveId(activeThread.id);
    }
  }, [activeThread, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [activeThread?.messages.length, streaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [draft]);

  const currentProviderInfo = useMemo(() => {
    if (!config?.providers?.length) return null;
    return config.providers.find((p) => p.id === provider) || config.providers[0];
  }, [config, provider]);

  const updateThreadMessages = (threadId, updater) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== threadId) return t;
        const nextMessages = updater(t.messages);
        return {
          ...t,
          title: deriveTitle(nextMessages),
          updatedAt: Date.now(),
          messages: nextMessages,
        };
      })
    );
  };

  const appendSystemNote = (threadId, content) => {
    updateThreadMessages(threadId, (msgs) => [
      ...msgs,
      { id: createId(), role: "system", content, createdAt: Date.now() },
    ]);
  };

  const handleNewThread = () => {
    if (streaming) return;
    const fresh = createThread();
    setThreads((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setErrorMsg("");
    textareaRef.current?.focus();
    if (window.innerWidth <= 780) setRailCollapsed(true);
  };

  const handleDeleteThread = (id) => {
    if (streaming && id === activeThread?.id) return;
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        const fresh = createThread();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeThread?.id) {
        setActiveId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleClearThread = () => {
    if (streaming || !activeThread) return;
    setErrorMsg("");
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? { ...t, title: "Untitled note", updatedAt: Date.now(), messages: [] }
          : t
      )
    );
  };

  const handleExportMarkdown = () => {
    if (!activeThread || activeThread.messages.length === 0) return;
    const botLabel = config?.botName || "Jarvis";
    const lines = [
      `# ${activeThread.title}`,
      "",
      ...activeThread.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const speaker = m.role === "user" ? "You" : botLabel;
          return `**${speaker}** (${formatTime(m.createdAt)})\n\n${m.content}\n`;
        }),
    ];
    const blob = new Blob([lines.join("\n---\n\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeThread.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "note"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMessage = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const runAssistantTurn = async (threadId, apiMessages, selectedProvider) => {
    const assistantId = createId();
    const modelLabel =
      config?.providers?.find((p) => p.id === selectedProvider)?.model || "";

    updateThreadMessages(threadId, (msgs) => [
      ...msgs,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        model: modelLabel,
        createdAt: Date.now(),
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setErrorMsg("");

    try {
      await streamChat({
        messages: apiMessages,
        provider: selectedProvider,
        signal: controller.signal,
        onDelta: (chunk) => {
          updateThreadMessages(threadId, (msgs) =>
            msgs.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m
            )
          );
        },
      });
    } catch (err) {
      if (err.name === "AbortError") {
        updateThreadMessages(threadId, (msgs) =>
          msgs.filter((m) => !(m.id === assistantId && !m.content.trim()))
        );
      } else {
        updateThreadMessages(threadId, (msgs) =>
          msgs.filter((m) => !(m.id === assistantId && !m.content.trim()))
        );
        setErrorMsg(err.message || "Unable to complete response.");
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      textareaRef.current?.focus();
    }
  };

  const sendMessage = async (overrideText) => {
    const raw = (overrideText ?? draft).trim();
    if (!raw || streaming || !activeThread) return;

    const cmd = raw.toLowerCase();
    if (cmd === "/clear") {
      setDraft("");
      handleClearThread();
      return;
    }

    if (cmd === "/gemini" || cmd === "/groq") {
      const target = cmd.slice(1);
      setDraft("");
      const found = config?.providers?.find((p) => p.id === target);
      if (!found) {
        appendSystemNote(
          activeThread.id,
          `${target} is not configured. Check its API key in .env.`
        );
      } else {
        setProvider(found.id);
        appendSystemNote(
          activeThread.id,
          `Switched engine to ${found.label} (${found.model}).`
        );
      }
      return;
    }

    if (cmd === "/provider") {
      setDraft("");
      const available =
        config?.providers?.map((p) => `${p.id} (${p.model})`).join(", ") || "none";
      appendSystemNote(
        activeThread.id,
        `Active: ${currentProviderInfo?.id || provider} (${currentProviderInfo?.model || "unknown"}). Available: ${available}.`
      );
      return;
    }

    if (!overrideText) setDraft("");
    setErrorMsg("");

    const userMsg = {
      id: createId(),
      role: "user",
      content: raw,
      createdAt: Date.now(),
    };

    const nextHistory = [...activeThread.messages, userMsg];
    updateThreadMessages(activeThread.id, () => nextHistory);

    const apiMessages = nextHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    await runAssistantTurn(
      activeThread.id,
      apiMessages,
      currentProviderInfo?.id || provider
    );
  };

  const handleRetry = async () => {
    if (streaming || !activeThread) return;
    const apiMessages = activeThread.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    if (!apiMessages.length || apiMessages[apiMessages.length - 1].role !== "user") {
      return;
    }
    await runAssistantTurn(
      activeThread.id,
      apiMessages,
      currentProviderInfo?.id || provider
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const groupedThreads = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();
    return {
      today: threads.filter((t) => (t.updatedAt || t.createdAt) >= cutoff),
      earlier: threads.filter((t) => (t.updatedAt || t.createdAt) < cutoff),
    };
  }, [threads]);

  const botName = (config?.botName || "Jarvis").toUpperCase();
  const userTitle = config?.userTitle || "sir";
  const isEmpty = !activeThread?.messages?.length;

  return (
    <div className={`desk-shell ${railCollapsed ? "rail-collapsed" : ""}`}>
      <div className="rail-backdrop" onClick={() => setRailCollapsed(true)} />

      <aside className="rail" aria-label="Correspondence archive">
        <div className="rail-head">
          <h1 className="wordmark">{config?.botName || "Jarvis"}</h1>
          <span className="edition-tag">Desk</span>
        </div>

        <div className="rail-actions">
          <button
            type="button"
            className="new-thread-btn"
            onClick={handleNewThread}
            disabled={streaming}
          >
            <span>+ New thread</span>
          </button>
        </div>

        <nav className="thread-list">
          {groupedThreads.today.length > 0 && (
            <>
              <div className="thread-group-label">Today</div>
              {groupedThreads.today.map((t) => (
                <div
                  key={t.id}
                  className={`thread-item ${t.id === activeThread?.id ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="thread-select"
                    onClick={() => {
                      if (!streaming) {
                        setActiveId(t.id);
                        setErrorMsg("");
                        if (window.innerWidth <= 780) setRailCollapsed(true);
                      }
                    }}
                  >
                    <span className="thread-title">{t.title}</span>
                    <span className="thread-meta">
                      {t.messages.filter((m) => m.role !== "system").length} notes ·{" "}
                      {formatTime(t.updatedAt || t.createdAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="thread-delete"
                    title="Delete thread"
                    aria-label={`Delete ${t.title}`}
                    onClick={() => handleDeleteThread(t.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}

          {groupedThreads.earlier.length > 0 && (
            <>
              <div className="thread-group-label">Earlier</div>
              {groupedThreads.earlier.map((t) => (
                <div
                  key={t.id}
                  className={`thread-item ${t.id === activeThread?.id ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="thread-select"
                    onClick={() => {
                      if (!streaming) {
                        setActiveId(t.id);
                        setErrorMsg("");
                        if (window.innerWidth <= 780) setRailCollapsed(true);
                      }
                    }}
                  >
                    <span className="thread-title">{t.title}</span>
                    <span className="thread-meta">
                      {t.messages.filter((m) => m.role !== "system").length} notes
                    </span>
                  </button>
                  <button
                    type="button"
                    className="thread-delete"
                    title="Delete thread"
                    aria-label={`Delete ${t.title}`}
                    onClick={() => handleDeleteThread(t.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="rail-foot">
          <div>
            <div className="engine-label-row">
              <span className="section-micro">Engine</span>
            </div>
            {config?.providers?.length ? (
              <>
                <div className="segmented" role="group" aria-label="Model provider">
                  {config.providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`segmented-btn ${
                        currentProviderInfo?.id === p.id ? "is-active" : ""
                      }`}
                      onClick={() => !streaming && setProvider(p.id)}
                      disabled={streaming}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="model-slug" title={currentProviderInfo?.model}>
                  {currentProviderInfo?.model}
                </div>
              </>
            ) : (
              <div className="model-slug">Connecting…</div>
            )}
          </div>

          <div className="rail-bottom-row">
            <span className="section-micro">
              Window: {config?.maxHistory ?? 10} turns
            </span>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((t) => (t === "paper" ? "ink" : "paper"))}
            >
              {theme === "paper" ? "Paper" : "Ink"}
            </button>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setRailCollapsed((c) => !c)}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
            >
              <SidebarIcon />
            </button>
            <span className="topbar-title">{activeThread?.title || "Untitled note"}</span>
          </div>

          <div className="topbar-right">
            <span className={`status-pill ${streaming ? "is-writing" : ""}`}>
              {streaming
                ? "Writing…"
                : currentProviderInfo
                  ? `${currentProviderInfo.label} · ${currentProviderInfo.model}`
                  : "Offline"}
            </span>
            <button
              type="button"
              className="text-btn"
              onClick={handleExportMarkdown}
              disabled={isEmpty || streaming}
            >
              Export .md
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={handleClearThread}
              disabled={isEmpty || streaming}
            >
              Clear
            </button>
          </div>
        </header>

        <div className="transcript-scroll">
          <div className="ledger-column">
            {configError && (
              <div className="error-banner" role="alert">
                <span className="error-text">
                  Backend unavailable: {configError}
                </span>
                <button type="button" className="retry-btn" onClick={loadBackendConfig}>
                  Reconnect
                </button>
              </div>
            )}

            {isEmpty ? (
              <section className="empty-desk">
                <div className="empty-rule" />
                <h2 className="empty-heading">At your service, {userTitle}.</h2>
                <p className="empty-sub">
                  Correspondence is ready. Write below, or enter{" "}
                  <code>/gemini</code>, <code>/groq</code>, or <code>/clear</code>.
                </p>

                <div className="index-list">
                  {STARTER_PROMPTS.map((prompt, idx) => (
                    <button
                      key={prompt}
                      type="button"
                      className="index-item"
                      onClick={() => sendMessage(prompt)}
                      disabled={Boolean(configError)}
                    >
                      <span className="index-num">0{idx + 1}</span>
                      <span className="index-text">{prompt}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div>
                {activeThread.messages.map((msg, idx) => {
                  const isLast = idx === activeThread.messages.length - 1;
                  const isStreamingTurn =
                    streaming && isLast && msg.role === "assistant";

                  return (
                    <article
                      key={msg.id}
                      className={`turn turn-${msg.role}`}
                    >
                      <div className="turn-header">
                        <div className="turn-speaker-wrap">
                          <span className="turn-speaker">
                            {msg.role === "user"
                              ? "You"
                              : msg.role === "assistant"
                                ? botName
                                : "Note"}
                          </span>
                          <span className="turn-time">{formatTime(msg.createdAt)}</span>
                          {msg.model && <span className="turn-time">· {msg.model}</span>}
                        </div>

                        {msg.role !== "system" && msg.content && (
                          <div className="turn-actions">
                            <button
                              type="button"
                              className="text-btn"
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                            >
                              {copiedId === msg.id ? "Copied" : "Copy"}
                            </button>
                          </div>
                        )}
                      </div>

                      {msg.role === "user" ? (
                        <div className="user-body">{msg.content}</div>
                      ) : msg.role === "system" ? (
                        <div className="system-body">{msg.content}</div>
                      ) : (
                        <MarkdownBody
                          content={msg.content}
                          streaming={isStreamingTurn}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {errorMsg && (
              <div className="error-banner" role="alert">
                <span className="error-text">{errorMsg}</span>
                <button type="button" className="retry-btn" onClick={handleRetry}>
                  Retry
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="composer-dock">
          <div className="composer-box">
            <textarea
              ref={textareaRef}
              className="composer-input"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a message…"
              aria-label="Message input"
              disabled={Boolean(configError)}
            />
            <div className="composer-bar">
              <div className="composer-hints">
                {draft.trim().startsWith("/") ? (
                  <span className="slash-hint">
                    Commands: /gemini · /groq · /provider · /clear
                  </span>
                ) : (
                  <span>
                    {currentProviderInfo
                      ? `${currentProviderInfo.label} (${currentProviderInfo.model})`
                      : "Connecting…"}
                  </span>
                )}
              </div>
              <div className="composer-actions">
                <span className="key-hint">Enter to send · Shift+Enter newline</span>
                {streaming ? (
                  <button type="button" className="stop-btn" onClick={handleStop}>
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="send-btn"
                    onClick={() => sendMessage()}
                    disabled={!draft.trim() || Boolean(configError)}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
