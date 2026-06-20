import { useEffect, useRef, useState, useCallback } from "react";

interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void;
  reconnectInterval?: number;
  maxRetries?: number;
}

export function useWebSocket(
  taskId: string | null,
  options?: UseWebSocketOptions
) {
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const maxRetries = options?.maxRetries ?? 10;
  const interval = options?.reconnectInterval ?? 3000;
  const onMessageRef = useRef(options?.onMessage);
  onMessageRef.current = options?.onMessage;

  const connect = useCallback(() => {
    if (!taskId) return;

    const ws = new WebSocket(`ws://localhost:8000/ws/tasks/${taskId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      retriesRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastMessage(data);
        onMessageRef.current?.(data);
      } catch {
        setLastMessage(event.data);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      if (retriesRef.current < maxRetries) {
        retriesRef.current += 1;
        setTimeout(connect, interval);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    setStatus("connecting");
  }, [taskId, interval, maxRetries]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { lastMessage, status, sendMessage };
}
