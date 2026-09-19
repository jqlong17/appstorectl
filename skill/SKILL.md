---
name: appstore-release-cli
description: >-
  App Store Connect release with the local appstorectl CLI: archive, upload,
  metadata, pricing, screenshots, store profiles, attach-build, and review
  submit. Use when the user wants to ship an iOS or macOS App Store build.
---

# App Store Release CLI

Prefer this repo's CLI over browser automation.

Required env (never print `.p8` contents):

- `ASC_ISSUER_ID`
- `ASC_KEY_ID`
- `ASC_PRIVATE_KEY_PATH` or `ASC_PRIVATE_KEY`

Keep each app's data in the **local** working copy, not in a public fork:

- `apps/<app>/appstore.config.json`
- `profiles/<profile>.json`
- `apps/<app>/metadata/*.json`
- `apps/<app>/review-notes.md`
- `apps/<app>/screenshots/<displayType>/`

Always `inspect-app` before copying another app's locale, categories, or screenshot slots.

## First-time app

API Keys cannot `POST /v1/apps` (403). A yellow agreement banner means the Account Holder must Agree first.

```bash
node ./bin/appstorectl.js prepare-new-app example
```

Then the user creates the app in the App Store Connect web UI. `altool` cannot upload until that record exists.

## Fast workflow

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
node ./bin/appstorectl.js inspect-app example
node ./bin/appstorectl.js ensure-store-profile example
node ./bin/appstorectl.js build example
node ./bin/appstorectl.js upload-build example
node ./bin/appstorectl.js list-builds example
node ./bin/appstorectl.js attach-build example --wait
node ./bin/appstorectl.js sync-metadata example --create-version
node ./bin/appstorectl.js sync-release-info example
node ./bin/appstorectl.js sync-pricing example
python3 ./scripts/prepare_screenshots.py \
  --source /path/to/source-shots \
  --dest ./apps/example/screenshots/APP_IPHONE_67 \
  --display-type APP_IPHONE_67
node ./bin/appstorectl.js upload-screenshots example --replace
node ./scripts/asc_release_check.js --app example
```

Web UI: fill App Privacy **and Publish**. Submit only with user confirmation:

```bash
node ./bin/appstorectl.js submit example --yes
```

## Screenshot rules

- iPhone: `APP_IPHONE_67` at `1290x2796`
- iPad 13-inch: `APP_IPAD_PRO_3GEN_129` at `2048x2732`
- iPhone-only: `requiredDisplayTypes: ["APP_IPHONE_67"]`
- Camera preview in Simulator is black; use a device for camera apps
- `upload-screenshots` appends; use `--replace` when swapping images

## Blockers the API cannot fix

- Create app record (403)
- Developer Program License Agreement
- App Privacy Publish
- First-version primary-locale `whatsNew`
