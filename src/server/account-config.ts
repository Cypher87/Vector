export type LocalRegistrationMode = 'always' | 'disabled' | 'first-user';

export type AccountServerConfig = {
  apple?: {
    clientId: string;
    keyId: string;
    privateKeyFile: string;
    teamId: string;
  };
  google?: {
    clientId: string;
    clientSecret: string;
  };
  localRegistration: LocalRegistrationMode;
  publicUrl?: URL;
  storePath: string;
};

const optionalText = (value: string | undefined) => value?.trim() || undefined;

const registrationMode = (value: string | undefined): LocalRegistrationMode => {
  switch (value?.trim().toLowerCase()) {
    case 'true':
    case 'always':
      return 'always';
    case 'false':
    case 'disabled':
      return 'disabled';
    default:
      return 'first-user';
  }
};

const configuredPublicUrl = (value: string | undefined) => {
  const text = optionalText(value);
  if (!text) return undefined;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('VECTOR_PUBLIC_URL must be an absolute HTTP(S) origin without credentials, a path, query parameters or a fragment');
  }
  return url;
};

export function readAccountServerConfig(
  environment: Record<string, string | undefined> = process.env,
): AccountServerConfig {
  const googleClientId = optionalText(environment.VECTOR_GOOGLE_CLIENT_ID);
  const googleClientSecret = optionalText(environment.VECTOR_GOOGLE_CLIENT_SECRET);
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('VECTOR_GOOGLE_CLIENT_ID and VECTOR_GOOGLE_CLIENT_SECRET must be configured together');
  }

  const appleClientId = optionalText(environment.VECTOR_APPLE_CLIENT_ID);
  const appleTeamId = optionalText(environment.VECTOR_APPLE_TEAM_ID);
  const appleKeyId = optionalText(environment.VECTOR_APPLE_KEY_ID);
  const applePrivateKeyFile = optionalText(environment.VECTOR_APPLE_PRIVATE_KEY_FILE);
  const appleParts = [appleClientId, appleTeamId, appleKeyId, applePrivateKeyFile];
  if (appleParts.some(Boolean) && !appleParts.every(Boolean)) {
    throw new Error('All VECTOR_APPLE_* settings must be configured together');
  }

  const publicUrl = configuredPublicUrl(environment.VECTOR_PUBLIC_URL);
  if (
    googleClientId
    && (!publicUrl || (publicUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(publicUrl.hostname)))
  ) {
    throw new Error('Sign in with Google requires an HTTPS VECTOR_PUBLIC_URL (HTTP is accepted only for localhost development)');
  }
  if (appleClientId && publicUrl?.protocol !== 'https:') {
    throw new Error('Sign in with Apple requires VECTOR_PUBLIC_URL to use HTTPS');
  }

  return {
    localRegistration: registrationMode(environment.VECTOR_LOCAL_REGISTRATION),
    publicUrl,
    storePath: optionalText(environment.VECTOR_ACCOUNT_STORE)
      || (process.platform === 'win32' ? `${process.cwd()}/.vector/accounts.json` : '/var/lib/vector/accounts.json'),
    ...(googleClientId && googleClientSecret ? {
      google: { clientId: googleClientId, clientSecret: googleClientSecret },
    } : {}),
    ...(appleClientId && appleTeamId && appleKeyId && applePrivateKeyFile ? {
      apple: {
        clientId: appleClientId,
        keyId: appleKeyId,
        privateKeyFile: applePrivateKeyFile,
        teamId: appleTeamId,
      },
    } : {}),
  };
}
