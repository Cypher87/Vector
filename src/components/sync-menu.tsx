'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { translate, type Language, type TranslationKey } from '../i18n';
import { VectorIcon } from './vector-icon';

type SyncMenuProps = {
  connected: boolean;
  error?: string;
  language: Language;
  loading: boolean;
  onClearError: () => void;
  onCreatePairingCode: () => Promise<{ code: string; expiresAt: number }>;
  onDelete: () => Promise<unknown>;
  onDisconnect: () => Promise<unknown>;
  onPair: (code: string) => Promise<unknown>;
  onStart: () => Promise<unknown>;
};

const errorTranslation: Record<string, TranslationKey> = {
  DEVICE_LIMIT: 'syncDeviceLimit',
  PAIRING_CODE_INVALID: 'syncInvalidCode',
  RATE_LIMITED: 'syncRateLimited',
  SYNC_FAILED: 'syncErrorGeneric',
  SYNC_NOT_CONNECTED: 'syncNotConnected',
  SYNC_UNAVAILABLE: 'syncUnavailable',
};

const normalizePairingCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const inputCode = (value: string) => {
  const normalized = normalizePairingCode(value).slice(0, 6);
  return normalized.length > 3 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : normalized;
};

export function SyncMenu({
  connected,
  error,
  language,
  loading,
  onClearError,
  onCreatePairingCode,
  onDelete,
  onDisconnect,
  onPair,
  onStart,
}: SyncMenuProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const t = (key: TranslationKey) => translate(language, key);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const run = async (operation: () => Promise<unknown>) => {
    setSubmitting(true);
    onClearError();
    try {
      await operation();
    } catch {
      // The hook exposes a translated error in this panel.
    } finally {
      setSubmitting(false);
    }
  };

  const pair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (normalizePairingCode(code).length !== 6) return;
    void run(async () => {
      await onPair(code);
      setCode('');
      setGeneratedCode(undefined);
    });
  };

  const createCode = () => void run(async () => {
    const result = await onCreatePairingCode();
    setGeneratedCode(result.code);
  });

  const deleteAll = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void run(async () => {
      await onDelete();
      setGeneratedCode(undefined);
      setConfirmDelete(false);
      setOpen(false);
    });
  };

  return (
    <div className={`sync-menu ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        className={`settings-button sync-button ${connected ? 'connected' : ''}`}
        type="button"
        aria-expanded={open}
        aria-label={t('syncOpen')}
        title={t('syncOpen')}
        onClick={() => {
          setOpen((current) => !current);
          setConfirmDelete(false);
          onClearError();
        }}
      >
        <VectorIcon name="sync" />
        {connected && <span className="sync-state-dot" />}
      </button>

      {open && (
        <section className="sync-popover">
          <header>
            <strong>{t('syncTitle')}</strong>
            <button type="button" aria-label={t('syncClose')} onClick={() => setOpen(false)}>
              <VectorIcon name="close" />
            </button>
          </header>

          {loading ? <div className="sync-loading">{t('syncLoading')}</div> : connected ? (
            <>
              <button className="sync-primary" type="button" disabled={submitting} onClick={createCode}>
                <VectorIcon name="sync" />
                {t('syncNewDevice')}
              </button>
              {generatedCode && (
                <div className="sync-generated-code">
                  <strong>{generatedCode}</strong>
                  <span>{t('syncCodeInstructions')}</span>
                  <small>{t('syncCodeExpires')}</small>
                </div>
              )}
              {error && <p className="sync-error" role="alert">{t(errorTranslation[error] ?? 'syncErrorGeneric')}</p>}
              <div className="sync-actions">
                <button type="button" disabled={submitting} onClick={() => void run(async () => {
                  await onDisconnect();
                  setGeneratedCode(undefined);
                  setConfirmDelete(false);
                })}>
                  <VectorIcon name="unlink" />{t('syncDisconnectDevice')}
                </button>
                <button className={confirmDelete ? 'confirm' : ''} type="button" disabled={submitting} onClick={deleteAll}>
                  <VectorIcon name="trash" />{t(confirmDelete ? 'syncDeleteConfirm' : 'syncDeleteAll')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sync-intro">{t('syncIntro')}</p>
              <button className="sync-primary" type="button" disabled={submitting} onClick={() => void run(async () => {
                setGeneratedCode(undefined);
                await onStart();
              })}>
                <VectorIcon name="sync" />
                {submitting ? t('syncPleaseWait') : t('syncStart')}
              </button>
              <div className="sync-divider"><span>{t('syncConnectWithCode')}</span></div>
              <form className="sync-code-form" onSubmit={pair}>
                <label htmlFor="vector-sync-code">{t('syncCode')}</label>
                <div>
                  <input
                    id="vector-sync-code"
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    inputMode="text"
                    maxLength={7}
                    placeholder={t('syncCodePlaceholder')}
                    spellCheck={false}
                    value={code}
                    onChange={(event) => setCode(inputCode(event.target.value))}
                  />
                  <button type="submit" disabled={submitting || normalizePairingCode(code).length !== 6}>
                    {t('syncConnect')}
                  </button>
                </div>
              </form>
              {error && <p className="sync-error" role="alert">{t(errorTranslation[error] ?? 'syncErrorGeneric')}</p>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
