/** Optional email capture for daily reminders.
 *
 * Provider-agnostic on purpose: it POSTs the address as a form to whatever endpoint
 * `VITE_REMINDER_ENDPOINT` names, so a hosted form service (Buttondown, Formspree,
 * Mailchimp, a Worker) can be swapped without touching this file. No key is committed,
 * and with no endpoint configured the component renders nothing rather than showing a
 * field that silently discards addresses.
 */
import {useState} from 'react';

const ENDPOINT: string | undefined = import.meta.env.VITE_REMINDER_ENDPOINT;

type State = 'idle' | 'sending' | 'done' | 'error';

/** Deliberately permissive: the provider does real validation, and this only needs to
 * catch obvious typos before a round trip. */
const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

export function EmailSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  if (!ENDPOINT) return null;

  const submit = async (event: {preventDefault(): void}): Promise<void> => {
    event.preventDefault();
    if (!looksLikeEmail(email)) { setState('error'); return; }
    setState('sending');
    try {
      const body = new FormData();
      body.append('email', email.trim());
      const response = await fetch(ENDPOINT, {method: 'POST', body, headers: {Accept: 'application/json'}});
      setState(response.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return <p className="dbb-hint dbb-signup-done">Reminder set. One email a day, unsubscribe any time.</p>;
  }

  return (
    <form className="dbb-signup" onSubmit={(event: {preventDefault(): void}) => void submit(event)}>
      <label className="dbb-signup-label" htmlFor="dbb-email">Daily reminder by email (optional)</label>
      <div className="dbb-signup-row">
        <input
          id="dbb-email"
          className="dbb-signup-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event: {target: {value: string}}) => { setEmail(event.target.value); setState('idle'); }}
        />
        <button className="rpg-menu-item" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? '…' : 'Remind me'}
        </button>
      </div>
      {state === 'error' && (
        <p className="dbb-hint dbb-signup-error" role="alert">
          That did not go through. Check the address and try again.
        </p>
      )}
    </form>
  );
}
