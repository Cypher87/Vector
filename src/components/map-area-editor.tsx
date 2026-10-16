import { useState } from 'react';
import type { UnitSystem } from '../domain/aircraft';
import { filterMeasurement } from '../domain/aircraft-filters';
import { areaDistanceKm, drawingMapArea, maxAreaPoints, maxAreaRadiusKm, type AreaDrawing } from '../domain/map-area';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

export function MapAreaEditor({ drawing, language, units, onChange, onFinish, onCancel }: {
  drawing: AreaDrawing; language: Language; units: UnitSystem;
  onChange: (drawing: AreaDrawing) => void; onFinish: () => void; onCancel: () => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const distance = filterMeasurement('distance', units);
  const radius = drawing.radiusKm ?? (drawing.points.length >= 2 ? areaDistanceKm(drawing.points[0], drawing.points[1]) : undefined);
  const formattedRadius = radius !== undefined && Number.isFinite(radius) ? String(Number((radius * distance.factor).toFixed(2))) : '';
  const [radiusDraft, setRadiusDraft] = useState(formattedRadius);
  const [previousRadius, setPreviousRadius] = useState(formattedRadius);
  if (formattedRadius !== previousRadius) {
    setPreviousRadius(formattedRadius);
    setRadiusDraft(formattedRadius);
  }
  const ready = drawingMapArea(drawing);
  return <div className="map-area-editor" role="region" aria-label={t('areaDraw')}>
    <div className="area-editor-heading"><strong>{t(drawing.kind === 'circle' ? 'areaDrawCircle' : 'areaDrawPolygon')}</strong>
      <span role="status">{t(drawing.kind === 'circle' ? drawing.points.length ? 'areaChooseRadius' : 'areaChooseCenter' : 'areaChoosePoints')}
        {drawing.kind === 'polygon' && ` · ${drawing.points.length}/${maxAreaPoints}`}</span></div>
    {drawing.kind === 'circle' && drawing.points.length > 0 && <label className="area-radius">{t('areaRadius')}
      <input type="number" inputMode="decimal" aria-label={`${t('areaRadius')} (${distance.unit})`}
        min={.1 * distance.factor} max={maxAreaRadiusKm * distance.factor} step="any"
        value={radiusDraft} aria-invalid={radius !== undefined && !ready} onChange={(event) => {
          const value = event.target.value;
          const next = value === '' ? NaN : Number(value) / distance.factor;
          setRadiusDraft(value);
          setPreviousRadius(Number.isFinite(next) ? String(Number((next * distance.factor).toFixed(2))) : '');
          onChange({ ...drawing, radiusKm: next });
        }} />
      <span>{distance.unit}</span></label>}
    {drawing.kind === 'polygon' && drawing.points.length >= 3 && !ready && <span role="alert" className="area-editor-error">{t('areaInvalidPolygon')}</span>}
    <div className="area-editor-actions">
      <button type="button" disabled={!drawing.points.length} aria-label={t('areaUndo')} title={t('areaUndo')}
        onClick={() => onChange({ ...drawing, points: drawing.points.slice(0, -1), radiusKm: undefined })}><VectorIcon name="back" /></button>
      <button type="button" className="primary" disabled={!ready} onClick={onFinish}>{t('areaDone')}</button>
      <button type="button" onClick={onCancel}>{t('cancel')}</button>
    </div>
  </div>;
}
