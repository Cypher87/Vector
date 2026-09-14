import { oauthStartResponse } from '../../../../../src/server/account-http';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => oauthStartResponse('apple', request);
