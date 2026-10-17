import { isHeatmapPeriod } from '../../../src/domain/heatmap.ts';
import { getHeatmapService } from '../../../src/server/heatmap-service.ts';
import { readVectorServerConfig } from '../../../src/server/vector-config.ts';
import { rejectProxyLoop } from '../../../src/server/readsb-source.ts';
import { ResourceError } from '../../../src/server/bounded-resource.ts';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const query = new URL(request.url).searchParams, period = query.get('period');
  if ([...query.keys()].some((key) => key !== 'period') || query.getAll('period').length !== 1 || !isHeatmapPeriod(period)) {
    return Response.json({ error: 'invalid_period' }, { status: 400, headers });
  }
  try {
    const config = readVectorServerConfig(); rejectProxyLoop(request, config);
    const status = (await getHeatmapService(config)).request(period);
    return Response.json(status, { status: status.status === 'loading' ? 202 : status.status === 'error' ? 503 : 200, headers });
  } catch (error) {
    return Response.json({ error: 'heatmap_unavailable' }, { status: error instanceof ResourceError && error.status === 508 ? 508 : 503, headers });
  }
}
