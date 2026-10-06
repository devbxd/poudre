import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
const RANK = { cashier: 1, manager: 2, owner: 3 };
// last signed-in staff member, so the till still opens when the server cannot be reached
const KEY = 'poudre_staff';
const remember = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };
const remembered = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

export function AuthProvider({ children }) {
  const [staff, setStaffState] = useState(undefined);
  const setStaff = (s) => { setStaffState(s); remember(s); };
  useEffect(() => {
    api.get('/auth/me').then((r) => setStaff(r.staff)).catch((e) => {
      // signed out (401) → login screen; no connection → keep working as the last signed-in person
      if (e.status === 401) setStaff(null);
      else setStaffState(remembered());
    });
    const onLogout = () => setStaff(null);
    window.addEventListener('poudre:logout', onLogout);
    return () => window.removeEventListener('poudre:logout', onLogout);
  }, []);
  const value = {
    staff,
    can: (role) => !!staff && RANK[staff.role] >= RANK[role],
    login: async (body) => setStaff((await api.post('/auth/login', body)).staff),
    logout: async () => { await api.post('/auth/logout').catch(() => {}); setStaff(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
