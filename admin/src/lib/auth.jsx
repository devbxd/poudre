import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
const RANK = { cashier: 1, manager: 2, owner: 3 };

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(undefined);
  useEffect(() => {
    api.get('/auth/me').then((r) => setStaff(r.staff)).catch(() => setStaff(null));
    const onLogout = () => setStaff(null);
    window.addEventListener('poudre:logout', onLogout);
    return () => window.removeEventListener('poudre:logout', onLogout);
  }, []);
  const value = {
    staff,
    can: (role) => !!staff && RANK[staff.role] >= RANK[role],
    login: async (body) => setStaff((await api.post('/auth/login', body)).staff),
    logout: async () => { await api.post('/auth/logout'); setStaff(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
