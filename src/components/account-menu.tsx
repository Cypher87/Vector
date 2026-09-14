'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ClientAccount, ClientAuthProviders } from '../account/use-vector-account';
import { translate, type Language, type TranslationKey } from '../i18n';
import { VectorIcon } from './vector-icon';

type AccountMenuProps = {
  account: ClientAccount | null;
  authError?: string;
  language: Language;
  loading: boolean;
  onClearError: () => void;
  onRegister: (input: { email: string; name: string; password: string }) => Promise<unknown>;
  onSignIn: (input: { email: string; password: string }) => Promise<unknown>;
  onSignOut: () => Promise<void>;
  providers: ClientAuthProviders;
};

const errorTranslation: Record<string, TranslationKey> = {
  AUTH_FAILED: 'accountErrorGeneric',
  AUTH_UNAVAILABLE: 'accountUnavailable',
  EMAIL_EXISTS: 'accountEmailExists',
  INVALID_CREDENTIALS: 'accountInvalidCredentials',
  INVALID_EMAIL: 'accountInvalidEmail',
  INVALID_NAME: 'accountInvalidName',
  INVALID_PASSWORD: 'accountInvalidPassword',
  OAUTH_FAILED: 'accountOAuthFailed',
  PROVIDER_UNAVAILABLE: 'accountProviderUnavailable',
  RATE_LIMITED: 'accountRateLimited',
  REGISTRATION_DISABLED: 'accountRegistrationDisabled',
};

export function AccountMenu({ account, authError, language, loading, onClearError, onRegister, onSignIn, onSignOut, providers }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const t = (key: TranslationKey) => translate(language, key);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      if (registering) {
        await onRegister({
          email: String(form.get('email') ?? ''),
          name: String(form.get('name') ?? ''),
          password: String(form.get('password') ?? ''),
        });
      } else {
        await onSignIn({
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        });
      }
    } catch {
      return;
    } finally {
      setSubmitting(false);
    }
  };

  const initials = account?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className={`account-menu ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        className="settings-button account-button"
        type="button"
        aria-expanded={open}
        aria-label={account ? t('accountOpen') : t('accountSignIn')}
        title={account ? t('accountOpen') : t('accountSignIn')}
        onClick={() => { setOpen((current) => !current); onClearError(); }}
      >
        {account ? <strong>{initials || '?'}</strong> : <VectorIcon name="account" />}
      </button>

      {open && (
        <section className="account-popover">
          <header>
            <div>
              <strong>{t('account')}</strong>
              {!account && <small>{t('accountSyncIntro')}</small>}
            </div>
            <button type="button" aria-label={t('accountClose')} onClick={() => setOpen(false)}><VectorIcon name="close" /></button>
          </header>

          {loading ? <div className="account-loading">{t('accountLoading')}</div> : account ? (
            <>
              <div className="account-profile">
                <span>{initials || '?'}</span>
                <div><strong>{account.name}</strong><small>{account.email}</small></div>
              </div>
              <button className="account-signout" type="button" onClick={() => void onSignOut()}>
                <VectorIcon name="logout" />{t('accountSignOut')}
              </button>
            </>
          ) : (
            <>
              {(providers.google || providers.apple) && (
                <div className="account-providers">
                  {providers.google && <a href="/api/auth/oauth/google"><b>G</b>{t('accountContinueGoogle')}</a>}
                  {providers.apple && <a href="/api/auth/oauth/apple"><b className="apple-mark">●</b>{t('accountContinueApple')}</a>}
                </div>
              )}
              {(providers.google || providers.apple) && <div className="account-divider"><span>{t('accountOr')}</span></div>}
              <form className="account-form" onSubmit={submit}>
                {registering && <label><span>{t('accountName')}</span><input name="name" autoComplete="name" maxLength={80} required /></label>}
                <label><span>{t('accountEmail')}</span><input name="email" autoComplete="email" inputMode="email" type="email" maxLength={254} required /></label>
                <label><span>{t('accountPassword')}</span><input name="password" autoComplete={registering ? 'new-password' : 'current-password'} type="password" minLength={registering ? 12 : undefined} maxLength={128} required /></label>
                {registering && <small className="account-password-help">{t('accountPasswordHelp')}</small>}
                {authError && <p className="account-error" role="alert">{t(errorTranslation[authError] ?? 'accountErrorGeneric')}</p>}
                <button className="account-submit" type="submit" disabled={submitting}>{submitting ? t('accountPleaseWait') : t(registering ? 'accountCreate' : 'accountSignIn')}</button>
              </form>
              {providers.localRegistration && (
                <button className="account-mode" type="button" onClick={() => { setRegistering((current) => !current); onClearError(); }}>
                  {t(registering ? 'accountExisting' : 'accountNew')}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
