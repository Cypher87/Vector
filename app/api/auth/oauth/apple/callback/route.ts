import { oauthCallbackResponse } from '../../../../../../src/server/account-http';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => oauthCallbackResponse('apple', request);
