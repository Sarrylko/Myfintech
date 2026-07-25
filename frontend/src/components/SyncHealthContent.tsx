"use client";

import { useState, useEffect, useCallback } from "react";
import { useCurrency } from "@/lib/currency";
import { Loader2, RefreshCw, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  getSyncHealth,
  syncPlaidItem,
  syncSnapTradeConnection,
  getPlaidUpdateLinkToken,
  getSnapTradeReconnectUrl,
  ConnectionHealth,
} from "@/lib/api";

declare global {
  interface Window {
    Plaid: {
      create: (config: {
        token: string;
        onSuccess: (public_token: string, metadata: { institution?: { institution_id: string; name: string } }) => void;
        onExit: (err: unknown) => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}

const STATUS_BADGE: Record<ConnectionHealth["status"], "success" | "error" | "warning" | "neutral"> = {
  ok: "success",
  error: "error",
  stale: "warning",
  never_synced: "warning",
  disabled: "neutral",
};

const STATUS_LABEL: Record<ConnectionHealth["status"], string> = {
  ok: "Working",
  error: "Failed",
  stale: "Stale",
  never_synced: "Never synced",
  disabled: "Disabled",
};

export function SyncHealthContent() {
  const { locale } = useCurrency();
  const [connections, setConnections] = useState<ConnectionHealth[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; isError: boolean } | null>(null);
  const [plaidReady, setPlaidReady] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const data = await getSyncHealth();
      setConnections(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load Plaid Link script (needed to re-open Link in update mode)
  useEffect(() => {
    const existing = document.querySelector('script[src*="plaid.com/link"]');
    if (existing) { setPlaidReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => setPlaidReady(true);
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) document.body.removeChild(script); };
  }, []);

  async function handleRetry(conn: ConnectionHealth) {
    setRetryingId(conn.connection_id);
    setRowMessage(null);
    try {
      if (conn.connection_type === "plaid") {
        await syncPlaidItem(conn.connection_id);
      } else {
        await syncSnapTradeConnection(conn.connection_id);
      }
      setRowMessage({ id: conn.connection_id, text: "Sync succeeded", isError: false });
    } catch (e) {
      setRowMessage({
        id: conn.connection_id,
        text: e instanceof Error ? e.message : "Sync failed",
        isError: true,
      });
    } finally {
      setRetryingId(null);
      await load();
      setTimeout(() => setRowMessage(null), 4000);
    }
  }

  async function handleUpdateCredentials(conn: ConnectionHealth) {
    setRowMessage(null);

    if (conn.connection_type === "snaptrade") {
      setReconnectingId(conn.connection_id);
      try {
        const { redirect_url } = await getSnapTradeReconnectUrl(conn.connection_id);
        window.location.href = redirect_url;
      } catch (e) {
        setRowMessage({
          id: conn.connection_id,
          text: e instanceof Error ? e.message : "Failed to open reconnect portal",
          isError: true,
        });
        setReconnectingId(null);
      }
      return;
    }

    // Plaid: open Link in update mode so the user can re-enter credentials
    // for this same institution (no duplicate connection is created).
    if (!plaidReady || !window.Plaid) {
      setRowMessage({ id: conn.connection_id, text: "Plaid is still loading, please try again.", isError: true });
      return;
    }
    setReconnectingId(conn.connection_id);
    try {
      const { link_token } = await getPlaidUpdateLinkToken(conn.connection_id);
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async () => {
          try {
            await syncPlaidItem(conn.connection_id);
            setRowMessage({ id: conn.connection_id, text: "Credentials updated — sync succeeded", isError: false });
          } catch (e) {
            setRowMessage({ id: conn.connection_id, text: e instanceof Error ? e.message : "Sync failed", isError: true });
          } finally {
            setReconnectingId(null);
            await load();
            setTimeout(() => setRowMessage(null), 4000);
          }
        },
        onExit: () => { setReconnectingId(null); },
      });
      handler.open();
    } catch (e) {
      setRowMessage({
        id: conn.connection_id,
        text: e instanceof Error ? e.message : "Failed to open Plaid Link",
        isError: true,
      });
      setReconnectingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sync Health"
        subtitle="Status of every connected bank and brokerage account"
        action={
          <Button variant="secondary" size="sm" onClick={load} loading={loading}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card padding="none">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-content-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !connections || connections.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-content-muted">
            No connected accounts yet — link one from the Accounts page.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {connections.map((conn) => {
              const lastSynced = conn.last_synced_at
                ? new Date(conn.last_synced_at).toLocaleString(locale, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "Never";
              const isRetrying = retryingId === conn.connection_id;
              const isReconnecting = reconnectingId === conn.connection_id;
              const msg = rowMessage?.id === conn.connection_id ? rowMessage : null;
              const needsReauth = conn.status === "error";

              return (
                <div key={conn.connection_id} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-content-primary">{conn.name}</span>
                      <Badge variant="neutral">{conn.connection_type === "plaid" ? "Plaid" : "SnapTrade"}</Badge>
                      <Badge variant={STATUS_BADGE[conn.status]}>{STATUS_LABEL[conn.status]}</Badge>
                    </div>
                    <p className="text-xs text-content-muted mt-1">
                      {conn.accounts.length > 0 ? conn.accounts.join(", ") : "No accounts"}
                    </p>
                    <p className="text-xs text-content-muted mt-0.5">
                      Last synced {lastSynced}
                    </p>
                    {conn.status_detail && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{conn.status_detail}</p>
                    )}
                    {msg && (
                      <p className={`text-xs mt-1 ${msg.isError ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                        {msg.text}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isRetrying}
                      disabled={!conn.is_active || isReconnecting}
                      onClick={() => handleRetry(conn)}
                    >
                      Retry
                    </Button>
                    {needsReauth && (
                      <Button
                        variant="primary"
                        size="sm"
                        loading={isReconnecting}
                        disabled={!conn.is_active || isRetrying}
                        onClick={() => handleUpdateCredentials(conn)}
                        title="Re-enter your login credentials for this connection"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Update credentials
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
