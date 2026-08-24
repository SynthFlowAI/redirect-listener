# Redirect Listener

Static JavaScript assets for syncing React iframe navigation with Bubble parent-page URLs.

Bubble should load the Cloudflare Pages loader:

```html
<script defer src="https://redirect-listener.pages.dev/iframe-listener-loader.js"></script>
```

The loader selects the listener by Bubble URL version:

| Bubble URL | Listener |
| --- | --- |
| no `/version-*` | `iframe-listener-live.js` |
| `/version-1idf/` | `iframe-listener-1idf.js` |
| `/version-5idf/` | `iframe-listener-5idf.js` |
| `/version-8k1/` | `iframe-listener-5idf.js` |

## React To Bubble Redirects

Current `live`, `1idf`, and `5idf` behavior is the same.

| React route / Bubble-style URL | Bubble URL result |
| --- | --- |
| `/test-center/...` | `?page=test-center` plus `view`, `type`, `session_id`, `testCaseId` when present |
| `/knowledge-base` | `?page=rag` |
| `/aurora` | `?page=aurora` |
| `/analytics` | `?page=analytics` |
| `/workflows` or `/workflow-builder` | `?page=workflow-builder` |
| `/integrations` | `?page=third-parties` |
| `/agency` | `?page=subaccounts` |
| `/agents/:model/:view` | `?page=agents&model=:model&view=:view` |
| `/actions/:type` | `?page=actions&action_type=:type` plus action params when present |
| `/actions/custom-action/:path/:view` | `?page=actions&action_type=custom-action&action_path=:path&view=:view` |
| `/contacts/phone-books/:path?phone_book_id=...` | `?page=memory&contact_type=phone-books&phone_book_url=...&phone_book_path=:path` |
| `/contacts/memory-groups/:id` | `?page=memory&contact_type=memory-groups&memory_group_id=:id` |
| `/phone-numbers` | `?page=phones&action=phones-active` |
| `/settings/billing` or `?page=settings&action=billing` | `?page=billing` |
| `/settings/integrations` or `?page=settings&action=integrations` | `?page=third-parties` |
| `/settings/...` | `?page=preferences` |
| `?page=agency` | `?page=subaccounts` |
| `?page=integrations` | `?page=third-parties` |
| `/logs/:type` | `?page=logs&log_type=:type` plus `call`, `log`, `agentId`/`model` when present |

Global params preserved when allowed: `page`, `workspace`, `debug_mode`, and `conversationId`.

## Testing The Listener

Open the Bubble portal with `debug_mode=true`, then run:

```js
window.__portalIframeListenerLoaderDebug()
```

Expected on `version-1idf`:

```js
{
  detectedVersion: "version-1idf",
  selectedVersion: "version-1idf",
  selectedFile: "iframe-listener-1idf.js",
  selectedUrl: "https://redirect-listener.pages.dev/iframe-listener-1idf.js"
}
```

Expected on `version-5idf`:

```js
{
  detectedVersion: "version-5idf",
  selectedVersion: "version-5idf",
  selectedFile: "iframe-listener-5idf.js",
  selectedUrl: "https://redirect-listener.pages.dev/iframe-listener-5idf.js"
}
```

Then run:

```js
window.__portalListenerDebug()
```

Expected basics:

```js
{
  waitForReactIframeAuth: "yes",
  isReactIframeAuthReady: true,
  selectedIframeFn: "bubble_fn_set_main_iframe_from_url",
  refreshFn: "function"
}
```

Confirm only the Cloudflare listener scripts are loaded:

```js
[...document.scripts]
  .map((s) => s.src)
  .filter((src) => src.includes("redirect-listener"))
```

Expected:

```js
[
  "https://redirect-listener.pages.dev/iframe-listener-loader.js",
  "https://redirect-listener.pages.dev/iframe-listener-1idf.js"
]
```

For `5idf`, the second URL should end with `iframe-listener-5idf.js`.

Finally, test these redirects:

| Action | Expected parent URL |
| --- | --- |
| Go to settings billing | `?page=billing&workspace=...` |
| Go to settings integrations | `?page=third-parties&workspace=...` |
| Go to integrations | `?page=third-parties&workspace=...` |

## Post-Login Portal Handoff

`portal_handoff.js` runs in Bubble after a successful login for non-whitelabel users. It
sends the browser to the BFF, which redeems a one-time hash, sets the `security_token`
cookie and redirects on to the standalone portal app. Whitelabel users keep the existing
`write_cookie` iframe path and never run this script.

The hash is minted by a Bubble backend workflow and passed in as a dynamic value. This
repo is public and every `.js` is served with `Access-Control-Allow-Origin: *`, so nothing
here generates, derives or signs it.

| Bubble parameter | Value | Required |
| --- | --- | --- |
| `properties.param1` | BFF portal auth endpoint, e.g. `https://app.synthflow.ai/_api/portal/auth` | yes |
| `properties.param2` | One-time handoff hash | yes |
| `properties.param3` | Workspace ID, e.g. `Current User's workspace_selected's unique id` | no |

The endpoint goes through the portal app's own `/_api` proxy rather than a BFF host, so the
handoff and the cookie it sets stay first-party to `app.synthflow.ai`.

The destination is fixed at `/agents`, sent as the BFF's `redirect` parameter. The BFF lands
the user on `/portal` when no redirect is given, which is not where a post-login user should
arrive.

The workspace ID is passed through to the BFF, which carries it into the portal URL as
`?workspace=`. Without it the app has to resolve a workspace itself, so send it whenever
Bubble knows which one the user is opening.

The script navigates with `window.location.replace`, so the login page does not stay in
back history and a burnt hash cannot be replayed with the back button.

It does nothing at all — no navigation, user stays in Bubble — when the endpoint or the
hash is missing, blank or an unsubstituted `<...>` placeholder, when the endpoint is not a
valid URL, or when the endpoint is not `https`.

### Testing The Handoff

Open the Bubble login with `debug_mode=true` and run:

```js
window.__portalHandoffDebug()
```

Expected before a successful navigation:

```js
{
  endpoint: "https://app.synthflow.ai/_api/portal/auth",
  hasToken: true,
  redirect: "/agents",
  workspace: "1712345678901x123456789012345678",
  targetUrl: "https://app.synthflow.ai/_api/portal/auth?token=<redacted>&redirect=%2Fagents&workspace=...",
  skippedReason: null,
  navigated: true,
  alreadyStarted: true,
  debugMode: true
}
```

`skippedReason` names the guard that fired when nothing happened: `missing endpoint`,
`missing token`, `malformed endpoint`, `endpoint is not https`, or `already started`. The
hash is never logged or returned; `hasToken` and the redacted `targetUrl` are all the
inspector exposes.

A refused hash sends the user back to the Bubble login with `?error=portal_handoff`.

## Feature Flags

`load_feature_flags.js` pulls Flipt flags through `window.SynthflowFlags` and pushes each
one into a Bubble function.

| Flag key | Bubble function |
| --- | --- |
| `workflows_migration` | `bubble_fn_ff_workflows_migration` |
| `load_react_app_full_iframe` | `bubble_fn_ff_load_react_app_full_iframe` |
| `bubble_portal_login` | `bubble_fn_ff_bubble_portal_login` |

Flags initialise from the `workspace` URL parameter and are skipped entirely when it is
absent. The login page has no workspace yet, so `bubble_portal_login` cannot gate the
handoff there — that gate belongs in the Bubble login workflow, and the BFF stays
authoritative regardless, since it evaluates the same flag on the user's email.
