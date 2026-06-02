/*
 * Bubble dynamic values:
 *   properties.param1 = newly created workspace ID
 *   properties.param2 = target page, optional, defaults to "agents"
 *   properties.param3 = replace browser history yes/no, optional, defaults to "yes"
 *
 * Use this after Bubble creates a workspace in the parent page.
 * It navigates to the same portal URL with ?page=agents&workspace={workspaceId}
 * and performs a real page load so Bubble recomputes workspace-scoped values
 * before write_cookie.js runs.
 */
var WORKSPACE_ID = typeof properties !== "undefined" && properties ? properties.param1 : "";
var TARGET_PAGE = typeof properties !== "undefined" && properties ? properties.param2 : "";
var REPLACE_HISTORY = typeof properties !== "undefined" && properties ? properties.param3 : "";

function isBubbleYesForWorkspaceRedirect(value) {
  return value === true || /^(yes|true|1)$/i.test(String(value || "").trim());
}

function cleanBubbleValueForWorkspaceRedirect(value) {
  var clean = String(value || "").trim();
  return /^<.+>$/.test(clean) ? "" : clean;
}

(function redirectToWorkspace() {
  var workspaceId = cleanBubbleValueForWorkspaceRedirect(WORKSPACE_ID);
  var targetPage = cleanBubbleValueForWorkspaceRedirect(TARGET_PAGE) || "agents";
  var shouldReplace = REPLACE_HISTORY === "" || isBubbleYesForWorkspaceRedirect(REPLACE_HISTORY);

  if (!workspaceId) {
    console.error("[workspace-redirect] Missing properties.param1 workspace ID");
    return;
  }

  var url = new URL(window.location.href);
  url.searchParams.set("page", targetPage);
  url.searchParams.set("workspace", workspaceId);

  if (shouldReplace) window.location.replace(url.toString());
  else window.location.assign(url.toString());
})();
