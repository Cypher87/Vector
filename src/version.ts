import { version } from '../package.json';

// The UI and installer share this version; update package.json for a release.
export const vectorVersion = version;

declare const __VECTOR_BUILD_REVISION__: string;
export const vectorRevision = typeof __VECTOR_BUILD_REVISION__ === 'string' ? __VECTOR_BUILD_REVISION__ : '';
