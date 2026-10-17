import type { HeatmapState } from '../data/use-heatmap';
import { heatmapPeriods, parseHeatmapPeriod, type HeatmapPeriod } from '../domain/heatmap';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

export const heatmapPeriodLabels = { '1h': 'heatmap1h', '4h': 'heatmap4h', '8h': 'heatmap8h', '24h': 'heatmap24h', '7d': 'heatmap7d' } as const;
export function HeatmapLegend({ state, language, onPeriodChange, onClose }: {
  state: HeatmapState;
  language: Language;
  onPeriodChange: (period: HeatmapPeriod) => void;
  onClose: () => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const data = state.data;
  const availablePeriod = data?.first != null && data.last != null
    ? `${new Date(data.first * 1000).toLocaleString(language)} — ${new Date(data.last * 1000).toLocaleString(language)}` : undefined;
  return <aside className="heatmap-legend" aria-label={t('heatmap')} aria-busy={state.status === 'loading'} title={availablePeriod}>
    <header><strong>{t('heatmap')}</strong>
      <button type="button" className="heatmap-close" aria-label={t('heatmapHide')} title={t('heatmapHide')} onClick={onClose}>
        <VectorIcon name="close" />
      </button>
    </header>
    <select aria-label={t('heatmapPeriod')} value={state.period}
      onChange={(event) => onPeriodChange(parseHeatmapPeriod(event.target.value))}>
      {heatmapPeriods.map((period) => <option key={period} value={period}>{t(heatmapPeriodLabels[period])}</option>)}
    </select>
    {data && data.points.length > 0 && <div className="heatmap-key">
      <div className="heatmap-gradient" /><div className="heatmap-key-labels"><span>{t('heatmapLow')}</span><span>{t('heatmapHigh')}</span></div>
    </div>}
    <div role="status" className="heatmap-status">{state.status === 'loading' ? `${t('heatmapLoading')} ${state.loaded}/${state.total}`
      : state.status === 'error' ? t('heatmapUnavailable') : !data?.points.length ? t('heatmapEmpty') : ''}</div>
  </aside>;
}
