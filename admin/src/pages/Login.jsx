import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Button, Field, Input } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await login(form); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-900 font-bold text-white">P</div>
          <div>
            <div className="font-semibold">Poudre Beauty</div>
            <div className="text-[13px] text-zinc-500">Sign in to your dashboard</div>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Username or email">
            <Input autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <Button variant="primary" className="w-full" loading={busy}>Sign in</Button>
        </div>
      </form>
    </div>
  );
}
