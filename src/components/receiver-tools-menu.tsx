'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { translate, type Language } from '../i18n';
import { ReceiverDashboard, type ReceiverDashboardProps } from './receiver-dashboard';
import { SyncMenu, type SyncMenuProps } from './sync-menu';
import { VectorIcon } from './vector-icon';

export function ReceiverToolsMenu({ language, sync, receiver }: {
  language: Language;
  sync: Omit<SyncMenuProps, 'open' | 'onClose' | 'language'>;
  receiver: Omit<ReceiverDashboardProps, 'onClose' | 'language'>;
}) {
  const [view, setView] = useState<'menu' | 'sync' | 'receiver' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const close = () => { setView(null); trigger.current?.focus(); };

  useEffect(() => {
    if (!view) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setView(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [view]);

  return <div className={`receiver-tools-menu ${view ? 'open' : ''}`} ref={root}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && view) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <button ref={trigger} type="button" className="settings-button more-button" aria-label={t('moreTools')}
      aria-expanded={view !== null} aria-controls={view ? panelId : undefined}
      title={t('moreTools')} onClick={() => setView((current) => current ? null : 'menu')}>
      <VectorIcon name="more" /><span className="top-action-label">{t('moreTools')}</span>
    </button>
    <div ref={panel} id={panelId}>
      {view === 'menu' && <nav className="receiver-tools-popover" aria-label={t('moreTools')}>
        <button type="button" aria-label={t('syncOpen')} onClick={() => { sync.onClearError(); setView('sync'); }}>
          <VectorIcon name="sync" /><span>{t('syncTitle')}</span><VectorIcon name="chevronRight" />
        </button>
        <button type="button" className="receiver-dashboard-button" aria-label={t('openReceiverDashboard')} onClick={() => setView('receiver')}>
          <VectorIcon name="receiver" /><span>{t('receiverDashboard')}</span><VectorIcon name="chevronRight" />
        </button>
      </nav>}
      {view === 'sync' && <SyncMenu {...sync} language={language} open onClose={close} />}
      {view === 'receiver' && <ReceiverDashboard {...receiver} language={language} onClose={close} />}
    </div>
  </div>;
}
