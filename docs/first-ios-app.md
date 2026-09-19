# First iOS App Store submission

Lessons that keep showing up on a brand-new iOS app. None of this is tied to a specific product.

## API Keys cannot create the app record

`POST /v1/apps` returns 403 for App Store Connect API Keys. They may create a Bundle ID.

```bash
node ./bin/appstorectl.js prepare-new-app example
```

If App Store Connect shows a yellow license-agreement banner, the **Account Holder** must agree at [developer.apple.com/account](https://developer.apple.com/account) first. Then create the app in the web UI (+ → New App). `altool` cannot upload until that record exists.

Write the new App ID into `appStore.appId` and run `inspect-app`. Do not copy another app's locale, categories, or screenshot slots.

## Apple processes the first IPA on their side

Local archive is usually minutes. After upload, Apple unpacks, checks signing, and scans the binary. The first build of a new app often takes 5–15 minutes.

```bash
node ./bin/appstorectl.js list-builds example
node ./bin/appstorectl.js attach-build example --wait
```

`--build` matches the marketing version (`1.0`) or `CFBundleVersion` (`1`). If you are unsure, omit `--build` and attach the latest `VALID` build.

`upload-build` does not attach the build to the version.

## App Privacy has no working public write API

Fill the nutrition labels in the App Store Connect web UI, then click **Publish**. Skipping Publish causes `STATE_ERROR.APP_DATA_USAGES_REQUIRED` on submit.

## First-version What's New

The primary locale `whatsNew` is often not editable on version 1.0. The CLI skips it when App Store Connect says so.

## Legal URLs

Host a privacy and support page yourself. If you use Cloudflare, do **not** add `_redirects` from `/privacy` to `/privacy.html`. Pretty-URL redirects can 307-loop. A Worker that fetches `/privacy.html` internally is safe.

## iPhone-only vs universal

iPhone-only apps should set:

```json
"requiredDisplayTypes": ["APP_IPHONE_67"]
```

Universal / iPad apps also need `APP_IPAD_PRO_3GEN_129` at `2048x2732`, not `APP_IPAD_PRO_129`.

## Games

Set `primaryCategory` to `GAMES` and fill `primarySubcategoryOne` / `primarySubcategoryTwo` (for example `GAMES_BOARD` and `GAMES_STRATEGY`).
