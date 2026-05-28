'use strict';

/**
 * Build-time switch.
 *
 * Dev (this repo): DISTILL_INCLUDE_BACKEND = true — the optional hosted "Distill
 * cloud" backend client (Advanced settings + proxy routing) is available, so you
 * can develop/self-host against backend/.
 *
 * Production (Web Store): `npm run pack` rewrites this file to set the flag false,
 * producing a pure bring-your-own-key build with no hosted-backend option. The
 * backend/ server is never included in the packaged extension regardless.
 */
var DISTILL_INCLUDE_BACKEND = true;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DISTILL_INCLUDE_BACKEND };
}
