/*
 * Bubble dynamic values:
 *   properties.param1 = write cookie API URL
 *   properties.param2 = BFF auth token
 *   properties.param3 = React iframe landing page, e.g. "agents"
 */
var API_URL = typeof properties !== "undefined" && properties ? properties.param1 : "";
var AUTH_TOKEN = typeof properties !== "undefined" && properties ? properties.param2 : "";
var REACT_IFRAME_LANDING_PAGE = typeof properties !== "undefined" && properties ? properties.param3 : "";

var AUTH_READY_EVENT = "react_iframe_auth_ready";
var DEBUG = new URLSearchParams(location.search).get("debug_mode") === "true";
var cookieLog = function() {
  if (DEBUG) console.log.apply(console, ["[cookie]"].concat(Array.prototype.slice.call(arguments)));
};

function iframeSyncFnNameForCookie() {
  return "bubble_fn_set_main_iframe_from_url";
}

function isMissingBubbleValue(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function markReactIframeAuthReady(data) {
  window.__reactIframeLandingPage = isMissingBubbleValue(REACT_IFRAME_LANDING_PAGE)
    ? ""
    : String(REACT_IFRAME_LANDING_PAGE || "");
  window.__reactIframeAuthReady = true;
  window.__reactIframeAuthError = null;
  window.__reactIframeAuthResult = data || null;
  window.dispatchEvent(new CustomEvent(AUTH_READY_EVENT, {
    detail: {
      result: data || null,
      landingPage: window.__reactIframeLandingPage,
    },
  }));
}

function markReactIframeAuthFailed(error) {
  window.__reactIframeAuthReady = false;
  window.__reactIframeAuthError = error;
  console.error("Failed to write React iframe auth cookie:", error);
}

window.__reactIframeCookieDebug = function() {
  return {
    apiUrl: API_URL,
    hasToken: !isMissingBubbleValue(AUTH_TOKEN),
    landingPage: isMissingBubbleValue(REACT_IFRAME_LANDING_PAGE) ? "" : REACT_IFRAME_LANDING_PAGE,
    selectedIframeFn: iframeSyncFnNameForCookie(),
    selectedIframeFnType: typeof window[iframeSyncFnNameForCookie()],
    isAuthReady: window.__reactIframeAuthReady === true,
    authError: window.__reactIframeAuthError || null,
    authResult: window.__reactIframeAuthResult || null,
  };
};

async function writeReactIframeCookie() {
  window.__reactIframeLandingPage = isMissingBubbleValue(REACT_IFRAME_LANDING_PAGE)
    ? ""
    : String(REACT_IFRAME_LANDING_PAGE || "");

  if (window.__reactIframeAuthReady === true) {
    cookieLog("React iframe auth already ready");
    return window.__reactIframeAuthResult || null;
  }

  if (window.__reactIframeAuthInFlight) {
    cookieLog("React iframe auth already in flight");
    return window.__reactIframeAuthInFlight;
  }

  if (isMissingBubbleValue(API_URL)) {
    throw new Error("Missing properties.param1 write cookie API URL");
  }

  if (isMissingBubbleValue(AUTH_TOKEN)) {
    throw new Error("Missing properties.param2 BFF auth token");
  }

  var response = await fetch(API_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: AUTH_TOKEN }),
  });

  var data = null;
  try { data = await response.json(); } catch (e) {}

  if (!response.ok) {
    throw new Error("Cookie write failed with HTTP " + response.status + ": " + JSON.stringify(data));
  }

  cookieLog("Token sent successfully:", data);
  markReactIframeAuthReady(data);
  return data;
}

window.__reactIframeAuthReady = window.__reactIframeAuthReady === true;
window.__reactIframeAuthInFlight = writeReactIframeCookie()
  .catch(function(error) {
    markReactIframeAuthFailed(error);
    return null;
  })
  .finally(function() {
    window.__reactIframeAuthInFlight = null;
  });
