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

## React To Bubble Redirects

Current `1idf` and `5idf` behavior is the same.

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

Global params preserved when allowed: `page`, `workspace`, and `debug_mode`.

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
