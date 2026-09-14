import { oauthCallbackResponse } from '../../../../../../src/server/account-http';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => oauthCallbackResponse('google', request);
