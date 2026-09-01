# DVSA Slot Scanner Extension

Chrome extension content/background script pair for scanning DVSA booking pages and reserving slots from either:

- **Instructor portal flow** (tab-assisted scan and reserve)
- **Student portal flow** (background-triggered DOM or HTTP-only snipe)

## Install (unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `/home/runner/work/dvsa/dvsa`.

## Supported runtime flows

### 1) Manual scan from page UI

- Open either DVSA portal page.
- Use **Start Forward** / **Start Backward** in the injected panel.
- The scanner follows calendar navigation links and reserves when a slot is found.

### 2) Background-driven snipe request

- Instructor tab sends a request to background service worker.
- Background finds a student tab and attempts:
  1. `GET_PAGE_INFO` (csrf + execution)
  2. `EXECUTE_HTTP_SNIPE`
- If HTTP-only snipe cannot proceed, background falls back to `EXECUTE_SNIPE` (DOM path).

## Runtime message contract

### Content script → Background

- `REGISTER_TAB` `{ siteType }`
- `SNIPE_STATUS_UPDATE` `{ status, details }`

### Background → Content script

- `GET_PAGE_INFO` → `{ success, siteType, csrf, execution, url }`
- `EXECUTE_HTTP_SNIPE` `{ csrf, execution, timestamp, snipeData }`
- `EXECUTE_SNIPE` `{ snipeData }`
- `SNIPE_STATUS` `{ status, details }`
- `SNIPE_FAILED` `{ reason }`

## Settings behavior

- `startDate` / `endDate`: date window filter for slot detection.
- `maxReserves`: hard cap on successful reserve attempts in the current tab session.
- `autoRefresh` + `requestLimit`: refresh and auto-resume after configured request threshold.

If `startDate > endDate`, bounds are automatically normalized.

## Lightweight validation

No formal test harness currently exists in this repository. Validate with:

```bash
node --check /home/runner/work/dvsa/dvsa/background.js
node --check /home/runner/work/dvsa/dvsa/content.js
node /home/runner/work/dvsa/dvsa/validate-messaging-contract.js
```

And manually verify:

1. extension loads without console syntax errors,
2. scan starts/stops from panel controls,
3. background messages produce expected status updates.