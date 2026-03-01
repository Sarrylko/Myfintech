"use client";

import { useState, useRef, useEffect } from "react";
import { streamAiChat, saveLearnedAnswer, AiChatMessage } from "@/lib/api";

const STARTER_QUESTIONS = [
  "What is my current net worth?",
  "Where am I overspending this month?",
  "Summarize my investment portfolio",
  "Which bills are due soon?",
  "How much have I saved this year?",
  "What are my largest expenses?",
];

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

const LOW_CONFIDENCE_PHRASES = [
  "i don't have enough data",
  "i don't have information",
  "i cannot find",
  "no relevant financial data",
  "not in the context",
];

function isLowConfidence(text: string): boolean {
  const lower = text.toLowerCase();
  return LOW_CONFIDENCE_PHRASES.some((p) => lower.includes(p));
}

export default function AiPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [pastedAnswer, setPastedAnswer] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [chatGptQuestion, setChatGptQuestion] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const question = text.trim();
    setLastQuestion(question);
    setShowSavePanel(false);
    setPastedAnswer("");
    setSaveSuccess(false);

    // Build the conversation history for the API
    const history: AiChatMessage[] = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: question });

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", isStreaming: true },
    ]);
    setInput("");
    setLoading(true);

    try {
      const res = await streamAiChat(history);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const chunk = JSON.parse(data);
            const content: string = chunk.choices?.[0]?.delta?.content ?? "";
            if (content) {
              accumulated += content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: accumulated,
                  isStreaming: true,
                };
                return updated;
              });
            }
          } catch {
            // Ignore JSON parse errors on partial chunks
          }
        }
      }

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: accumulated,
          isStreaming: false,
        };
        return updated;
      });

      if (isLowConfidence(accumulated)) {
        setChatGptQuestion(question);
        setShowSavePanel(true);
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content:
            "Error connecting to the AI assistant. Make sure the AI stack is running (`docker compose -f docker-compose.ai.yml up -d`).",
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const openChatGPT = (question: string) => {
    navigator.clipboard.writeText(question).catch(() => {});
    window.open("https://chat.openai.com/", "_blank", "noopener,noreferrer");
  };

  const handleSaveAnswer = async () => {
    if (!pastedAnswer.trim() || savingAnswer) return;
    setSavingAnswer(true);
    try {
      await saveLearnedAnswer(lastQuestion, pastedAnswer.trim());
      setSaveSuccess(true);
      setShowSavePanel(false);
      setPastedAnswer("");
    } catch {
      // Keep panel open on failure
    } finally {
      setSavingAnswer(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          AI Financial Assistant
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Ask questions about your finances — powered by your live data and uploaded documents.
        </p>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
            <div className="text-5xl select-none">🤖</div>
            <div>
              <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                Ask me about your finances
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 max-w-md">
                I have access to your transactions, accounts, budgets, investments, properties,
                loans, and uploaded documents.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/30 dark:hover:border-indigo-700 transition disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm flex-shrink-0 mt-0.5 select-none">
                  🤖
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm"
                }`}
              >
                {msg.isStreaming && !msg.content ? (
                  <span className="text-gray-400 dark:text-gray-500 animate-pulse">
                    Thinking…
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}

                {/* "Ask ChatGPT" subtle link on completed assistant messages */}
                {msg.role === "assistant" && !msg.isStreaming && msg.content && (
                  <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => {
                        const userMsg = messages[i - 1]?.content ?? lastQuestion;
                        setChatGptQuestion(userMsg);
                        setLastQuestion(userMsg);
                        setShowSavePanel(true);
                      }}
                      className="text-xs text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition"
                    >
                      Not satisfied? Ask ChatGPT ↗
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Low-confidence / ChatGPT fallback panel */}
      {showSavePanel && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Not enough local data — get a better answer from ChatGPT
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Your question has been copied to clipboard. Paste ChatGPT&apos;s answer below to
                teach the local model for next time.
              </p>
            </div>
            <button
              onClick={() => openChatGPT(chatGptQuestion)}
              className="flex-shrink-0 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-amber-700 transition font-medium"
            >
              Open ChatGPT ↗
            </button>
          </div>
          <div className="space-y-2">
            <textarea
              value={pastedAnswer}
              onChange={(e) => setPastedAnswer(e.target.value)}
              placeholder="Paste ChatGPT's answer here to save it to the knowledge base…"
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                The local model will use this answer for similar questions in the future.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSavePanel(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 transition"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleSaveAnswer}
                  disabled={!pastedAnswer.trim() || savingAnswer}
                  className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition font-medium"
                >
                  {savingAnswer ? "Saving…" : "Save to Knowledge Base"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save success toast */}
      {saveSuccess && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-2.5 text-sm text-green-700 dark:text-green-300 flex items-center justify-between gap-3">
          <span>
            Answer saved! The local model will use this for similar questions next time.
          </span>
          <button
            onClick={() => setSaveSuccess(false)}
            className="text-green-500 hover:text-green-700 transition text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="Ask about your finances…"
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 transition"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition text-sm font-medium"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
