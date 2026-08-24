import { readVectorServerConfig } from '../../../src/server/vector-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(readVectorServerConfig().publicConfig, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: 'Vector server configuration is invalid' },
      { status: 500 },
    );
  }
}
