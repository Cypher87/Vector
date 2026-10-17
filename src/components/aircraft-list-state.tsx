import type { FeedStatus } from '../domain/aircraft';
import { translate, type Language, type TranslationKey } from '../i18n';

export function AircraftListState({ language, status, hasAircraft, hasFilters, hasSearch, history, onClear }: {
  language: Language;
  status: FeedStatus;
  hasAircraft: boolean;
  hasFilters: boolean;
  hasSearch: boolean;
  history: { open: boolean; loading: boolean; error: boolean };
  onClear: () => void;
}) {
  let message: TranslationKey;
  let canClear = false;
  let loading = false;
  if (history.open && history.loading) {
    message = 'historyLoading';
    loading = true;
  } else if (history.open && !hasAircraft) {
    message = history.error ? 'listHistoryUnavailable' : 'listHistoryEmpty';
  } else if (!history.open && status !== 'live') {
    message = status === 'connecting' ? 'connecting' : status === 'offline' ? 'receiverOffline' : 'listWaitingForData';
    loading = status === 'connecting';
  } else if (hasAircraft && (hasFilters || hasSearch)) {
    message = 'listNoMatches';
    canClear = true;
  } else {
    message = 'listNoAircraft';
  }
  return (
    <div className="aircraft-list-state">
      <p role="status">{loading && <span className="list-loading-indicator" aria-hidden="true" />}{translate(language, message)}</p>
      {canClear && <button type="button" onClick={onClear}>
        {translate(language, hasFilters ? 'listClearFilters' : 'listClearSearch')}
      </button>}
    </div>
  );
}
