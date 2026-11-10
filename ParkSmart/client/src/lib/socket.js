import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;
let socketToken = null;

function getSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  if (socket) socket.disconnect();
  socketToken = token;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  return socket;
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
  socketToken = null;
}

/**
 * Subscribe to live slot updates (FR-SLOT-06).
 * onSlot(slot) for each change; onResync() after (re)connect or a layout change —
 * Table 15: clients re-sync full state on reconnect.
 */
export function useLiveSlots(onSlot, onResync) {
  const [connected, setConnected] = useState(true);
  const slotRef = useRef(onSlot);
  const resyncRef = useRef(onResync);
  slotRef.current = onSlot;
  resyncRef.current = onResync;

  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    let first = true;
    const handleConnect = () => {
      setConnected(true);
      if (!first && resyncRef.current) resyncRef.current();
      first = false;
    };
    const handleDisconnect = () => setConnected(false);
    const handleSlot = (slot) => slotRef.current && slotRef.current(slot);
    const handleLayout = (d) => resyncRef.current && resyncRef.current(d);
    setConnected(s.connected);
    if (s.connected) first = false;
    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.on('connect_error', handleDisconnect);
    s.on('slot:updated', handleSlot);
    s.on('layout:changed', handleLayout);
    return () => {
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.off('connect_error', handleDisconnect);
      s.off('slot:updated', handleSlot);
      s.off('layout:changed', handleLayout);
    };
  }, []);

  return connected;
}

/** Browser online/offline flag (NFR-REL-03) */
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
