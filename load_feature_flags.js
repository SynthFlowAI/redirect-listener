/*
 * Loads Synthflow feature flags for the current workspace and sends their
 * values into Bubble functions.
 *
 * Bubble function outputs:
 *   bubble_fn_ff_workflows_migration(value)
 *   bubble_fn_ff_load_react_app_full_iframe(value)
 *   bubble_fn_ff_bubble_portal_login(value)
 *
 * Flags only load on pages whose URL carries ?workspace=; there is no workspace on the
 * login page, so bubble_portal_login is unavailable there and the post-login fork has to
 * be gated in Bubble instead.
 */
var FEATURE_FLAGS_CONFIG = [
  {
    key: "workflows_migration",
    defaultValue: false,
    bubbleFn: "bubble_fn_ff_workflows_migration",
  },
  {
    key: "load_react_app_full_iframe",
    defaultValue: false,
    bubbleFn: "bubble_fn_ff_load_react_app_full_iframe",
  },
  {
    key: "bubble_portal_login",
    defaultValue: false,
    bubbleFn: "bubble_fn_ff_bubble_portal_login",
  },
];

var featureFlagsWorkspaceId = new URLSearchParams(window.location.search).get("workspace");
var featureFlagsDebug = new URLSearchParams(window.location.search).get("debug_mode") === "true";
var featureFlagsLibTries = 0;
var featureFlagsMaxLibTries = 200;
var featureFlagsPollTries = 0;
var featureFlagsMaxPollTries = 60;
var featureFlagsPollMs = 100;

function featureFlagsLog() {
  if (featureFlagsDebug) console.log.apply(console, ["[flags]"].concat(Array.prototype.slice.call(arguments)));
}

function sendFeatureFlagToBubble(flag, value) {
  var fn = window[flag.bubbleFn];
  if (typeof fn === "function") {
    try {
      fn(value);
      featureFlagsLog(flag.key, value);
    } catch (e) {
      if (featureFlagsDebug) console.error(e);
    }
  } else {
    featureFlagsLog(flag.bubbleFn + " missing; skip");
  }
}

function pollFeatureFlags() {
  featureFlagsPollTries++;

  for (var i = 0; i < FEATURE_FLAGS_CONFIG.length; i++) {
    var flag = FEATURE_FLAGS_CONFIG[i];
    var value = flag.defaultValue;

    try {
      value = !!window.SynthflowFlags.isEnabled(flag.key, flag.defaultValue);
    } catch (e) {
      value = flag.defaultValue;
    }

    sendFeatureFlagToBubble(flag, value);
  }

  if (featureFlagsPollTries < featureFlagsMaxPollTries) {
    setTimeout(pollFeatureFlags, featureFlagsPollMs);
  }
}

function waitForFeatureFlagsLib() {
  featureFlagsLibTries++;

  if (!window.SynthflowFlags || !window.SynthflowFlags.init || !window.SynthflowFlags.isEnabled) {
    if (featureFlagsLibTries < featureFlagsMaxLibTries) {
      setTimeout(waitForFeatureFlagsLib, 50);
    } else {
      featureFlagsLog("SynthflowFlags library did not become available");
    }
    return;
  }

  if (window.__synthflow_flags_inited_for !== featureFlagsWorkspaceId) {
    window.__synthflow_flags_inited_for = featureFlagsWorkspaceId;
    try {
      window.SynthflowFlags.init({ workspaceId: featureFlagsWorkspaceId });
      featureFlagsLog("Initialized for workspace", featureFlagsWorkspaceId);
    } catch (e) {
      if (featureFlagsDebug) console.error(e);
    }
  }

  pollFeatureFlags();
}

window.__featureFlagsDebug = function() {
  return {
    workspaceId: featureFlagsWorkspaceId,
    libraryAvailable: !!(window.SynthflowFlags && window.SynthflowFlags.init && window.SynthflowFlags.isEnabled),
    initializedFor: window.__synthflow_flags_inited_for || null,
    libTries: featureFlagsLibTries,
    pollTries: featureFlagsPollTries,
    flags: FEATURE_FLAGS_CONFIG.map(function(flag) {
      var value = flag.defaultValue;
      try {
        if (window.SynthflowFlags && window.SynthflowFlags.isEnabled) {
          value = !!window.SynthflowFlags.isEnabled(flag.key, flag.defaultValue);
        }
      } catch (e) {}
      return {
        key: flag.key,
        value: value,
        bubbleFn: flag.bubbleFn,
        bubbleFnType: typeof window[flag.bubbleFn],
      };
    }),
  };
};

if (featureFlagsWorkspaceId) {
  waitForFeatureFlagsLib();
} else {
  featureFlagsLog("Missing workspace; skip feature flags");
}
