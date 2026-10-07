import { handleUpdateRequest } from '../../../src/server/update-http';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleUpdateRequest(request);
export const POST = (request: Request) => handleUpdateRequest(request);
