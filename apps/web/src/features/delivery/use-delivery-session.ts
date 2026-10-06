import type { DeliveryState, DomainEvents, RouteKind } from '@urbansafe/shared';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../../shared/socket';
import { deliveryApi, type DeliveryCall, type DeliveryFailure } from './api';
import { applyPosition, mergeState } from './delivery-state';
import { failureNotice, type Notice } from './format';
import { loadSessionId, saveSessionId } from './session-storage';

const NOTICE_MS = 4000;

export type DeliverySession = ReturnType<typeof useDeliverySession>;

type SessionActions = {
  apply: (incoming: DeliveryState) => void;
  showFailure: (reason: Exclude<DeliveryFailure, 'not_found' | 'conflict'>) => void;
  clearSession: () => void;
  isCurrent: (sessionId: string) => boolean;
};

function joinSession(sessionId: string, actions: SessionActions, startNew: () => Promise<void>) {
  getSocket().emit('delivery.join', { sessionId }, (joined) => {
    if (joined || !actions.isCurrent(sessionId)) return;
    actions.clearSession();
    void startNew();
  });
}

async function startNew(actions: SessionActions): Promise<void> {
  const result = await deliveryApi.create();
  if (result.ok) {
    actions.apply(result.state);
    joinSession(result.state.sessionId, actions, () => startNew(actions));
    return;
  }
  actions.showFailure(result.reason === 'not_found' || result.reason === 'conflict' ? 'failed' : result.reason);
}

export function useDeliverySession() {
  const [state, setState] = useState<DeliveryState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [booting, setBooting] = useState(true);
  const idRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const actionsRef = useRef<SessionActions>(null!);

  useEffect(() => {
    actionsRef.current = {
      apply(incoming) {
        idRef.current = incoming.sessionId;
        saveSessionId(incoming.sessionId);
        setState((current) => mergeState(current, incoming));
      },
      showFailure(reason) {
        setNotice(failureNotice(reason));
      },
      clearSession() {
        saveSessionId(null);
        idRef.current = null;
        setState(null);
      },
      isCurrent: (sessionId) => idRef.current === sessionId,
    };
  });

  async function run(request: () => Promise<DeliveryCall>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await request();
      if (result.ok) {
        actionsRef.current.apply(result.state);
        return;
      }
      if (result.reason === 'not_found') {
        actionsRef.current.clearSession();
        await startNew(actionsRef.current);
        return;
      }
      if (result.reason !== 'conflict') actionsRef.current.showFailure(result.reason);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const actions = actionsRef.current;
    void (async () => {
      const saved = loadSessionId();
      if (saved) {
        const existing = await deliveryApi.get(saved);
        if (cancelled) return;
        if (existing.ok) {
          actions.apply(existing.state);
          joinSession(existing.state.sessionId, actions, () => startNew(actions));
          setBooting(false);
          return;
        }
        saveSessionId(null);
      }
      if (cancelled) return;
      await startNew(actions);
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onUpdated = ({ state: incoming }: DomainEvents['delivery.updated']) => {
      setState((current) => mergeState(current, incoming));
    };
    const onPosition = (event: DomainEvents['delivery.position']) => {
      setState((current) => applyPosition(current, event));
    };
    const onConnect = () => {
      if (idRef.current) joinSession(idRef.current, actionsRef.current, () => startNew(actionsRef.current));
    };
    socket.on('delivery.updated', onUpdated);
    socket.on('delivery.position', onPosition);
    socket.on('connect', onConnect);
    return () => {
      socket.off('delivery.updated', onUpdated);
      socket.off('delivery.position', onPosition);
      socket.off('connect', onConnect);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return {
    state,
    notice,
    pending,
    booting,
    accept: () => void (state && run(() => deliveryApi.accept(state.sessionId))),
    choose: (kind: RouteKind) => void (state && run(() => deliveryApi.chooseRoute(state.sessionId, kind))),
    setSpeed: (multiplier: number) => {
      if (!state) return;
      void deliveryApi.setSpeed(state.sessionId, multiplier).then((result) => {
        if (result.ok) actionsRef.current.apply(result.state);
        else if (result.reason !== 'conflict' && result.reason !== 'not_found') actionsRef.current.showFailure(result.reason);
      });
    },
    next: () => void (state && run(() => deliveryApi.next(state.sessionId))),
    retry: () => void startNew(actionsRef.current),
  };
}
