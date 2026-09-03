/*
 * Bubble dynamic values:
 *   properties.param1 = BFF portal auth endpoint, e.g. "https://app.synthflow.ai/_api/portal/auth"
 *   properties.param2 = one-time handoff hash minted by the Bubble backend workflow
 *
 * Destination comes from window.bubblePathToReactPath (bubble_to_react_path.js)
 * when that script has already run on this page. Otherwise redirect is /agents.
 *
 * Run this after a successful Bubble login for users who are being forked to the
 * standalone portal app. It hands the browser to the BFF, which redeems the hash,
 * sets the security_token cookie and redirects on to the portal.
 *
 * This file is served publicly with Access-Control-Allow-Origin: *, so it must never
 * mint, derive or sign the hash, and must never contain a key or an endpoint credential.
 */
var PORTAL_HANDOFF_ENDPOINT = typeof properties !== "undefined" && properties ? properties.param1 : "";
var PORTAL_HANDOFF_TOKEN = typeof properties !== "undefined" && properties ? properties.param2 : "";

var PORTAL_HANDOFF_DEFAULT_REDIRECT = "/agents";

var PORTAL_HANDOFF_DEBUG = new URLSearchParams(location.search).get("debug_mode") === "true";

var portalHandoffState = {
  endpoint: "",
  hasToken: false,
  redirect: "",
  usedPathMapper: false,
  targetUrl: "",
  skippedReason: null,
  navigated: false,
};

function portalHandoffLog() {
  if (PORTAL_HANDOFF_DEBUG) console.log.apply(console, ["[PORTAL AUTH]"].concat(Array.prototype.slice.call(arguments)));
}

function cleanBubbleValueForPortalHandoff(value) {
  var clean = String(value || "").trim();
  return /^<.+>$/.test(clean) ? "" : clean;
}

function redactedPortalHandoffUrl(url) {
  var copy = new URL(url.toString());
  copy.searchParams.set("token", "<redacted>");
  return copy.toString();
}

function isSafePortalHandoffRedirect(path) {
  return typeof path === "string" && path.charAt(0) === "/" && path.charAt(1) !== "/" && path.indexOf("://") === -1;
}

function resolvePortalHandoffRedirect() {
  var map = window.bubblePathToReactPath;
  if (typeof map !== "function") {
    console.warn("[PORTAL AUTH] window.bubblePathToReactPath not found; defaulting redirect to /agents");
    return PORTAL_HANDOFF_DEFAULT_REDIRECT;
  }
  try {
    var mapped = cleanBubbleValueForPortalHandoff(map(location.href));
    if (!isSafePortalHandoffRedirect(mapped)) return PORTAL_HANDOFF_DEFAULT_REDIRECT;
    portalHandoffState.usedPathMapper = true;
    return mapped;
  } catch (e) {
    return PORTAL_HANDOFF_DEFAULT_REDIRECT;
  }
}

window.__portalHandoffDebug = function() {
  return {
    endpoint: portalHandoffState.endpoint,
    hasToken: portalHandoffState.hasToken,
    redirect: portalHandoffState.redirect,
    usedPathMapper: portalHandoffState.usedPathMapper,
    targetUrl: portalHandoffState.targetUrl,
    skippedReason: portalHandoffState.skippedReason,
    navigated: portalHandoffState.navigated,
    alreadyStarted: window.__portalHandoffStarted === true,
    debugMode: PORTAL_HANDOFF_DEBUG,
  };
};

(function forkToPortalHandoff() {
  var endpoint = cleanBubbleValueForPortalHandoff(PORTAL_HANDOFF_ENDPOINT);
  var token = cleanBubbleValueForPortalHandoff(PORTAL_HANDOFF_TOKEN);
  var redirect = resolvePortalHandoffRedirect();

  portalHandoffState.endpoint = endpoint;
  portalHandoffState.hasToken = !!token;
  portalHandoffState.redirect = redirect;

  portalHandoffLog("Starting handoff with", {
    endpoint: endpoint,
    hasToken: !!token,
    redirect: redirect,
    usedPathMapper: portalHandoffState.usedPathMapper,
  });

  if (window.__portalHandoffStarted === true) {
    portalHandoffState.skippedReason = "already started";
    portalHandoffLog("Handoff already started; skip");
    return;
  }

  if (!endpoint) {
    portalHandoffState.skippedReason = "missing endpoint";
    console.error("[PORTAL AUTH] Missing properties.param1 BFF portal auth endpoint");
    return;
  }

  if (!token) {
    portalHandoffState.skippedReason = "missing token";
    console.error("[PORTAL AUTH] Missing properties.param2 handoff hash");
    return;
  }

  var url = null;
  try {
    url = new URL(endpoint);
  } catch (e) {
    portalHandoffState.skippedReason = "malformed endpoint";
    console.error("[PORTAL AUTH] properties.param1 is not a valid URL:", endpoint);
    return;
  }

  if (url.protocol !== "https:") {
    portalHandoffState.skippedReason = "endpoint is not https";
    console.error("[PORTAL AUTH] properties.param1 must be https:", endpoint);
    return;
  }

  url.searchParams.set("token", token);
  url.searchParams.set("redirect", redirect);

  portalHandoffState.targetUrl = redactedPortalHandoffUrl(url);
  portalHandoffState.navigated = true;
  window.__portalHandoffStarted = true;

  portalHandoffLog("Redirecting to", portalHandoffState.targetUrl);
  window.location.replace(url.toString());
})();
