# appstorectl

[中文](./README.md)

Local CLI for App Store Connect release work: archive with Xcode, upload an IPA, sync metadata, attach a processed build, and submit for review.

This repository is the **engine + an example app folder**. Put your real apps, review contacts, certificates, and screenshots in a private working copy. Do not commit them here.

## Who it’s for / vs fastlane

Built for **indie iOS / macOS developers who ship from their own Mac**: you want a repeatable release path without standing up a full Ruby / fastlane stack first, and you want ASC gotchas encoded as commands instead of tribal knowledge.

Compared with fastlane (short version):

- **Lighter**: one Node CLI (Node ≥20); `npm i -g` — no Ruby gem toolchain.
- **Narrower scope**: local archive → upload → attach → metadata → submit; not a full CI platform.
- **ASC gotchas baked in**: API Keys cannot create apps or Cloud-sign; upload ≠ attach; `--wait` for PROCESSING; legacy submission create is gone.
- **Web UI still required**: creating the app record and Publishing App Privacy stay in App Store Connect.
- **Data stays private**: the published package ships only `apps/example`; real apps and contacts live on your machine.

If you need team-scale multi-lane / multi-platform automation, keep fastlane. If you are one person with a Mac and your own ASC key, this is the lighter default path.

## Install

```bash
npm i -g appstorectl
```

Or from source:

```bash
git clone https://github.com/jqlong17/appstorectl.git
cd appstorectl
npm link
```

Or run it in place:

```bash
node ./bin/appstorectl.js --help
```

Requires Node 20+, full Xcode.app, and an App Store Connect API Key.

```bash
export ASC_ISSUER_ID="..."
export ASC_KEY_ID="..."
export ASC_PRIVATE_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

Copy the `.p8` into `~/.appstoreconnect/private_keys/` as well. `xcrun altool` looks there. Never commit the key.

Minimal one-flow (after `apps/example` points at your Xcode project):

```bash
appstorectl doctor example
appstorectl build example
appstorectl upload-build example
appstorectl attach-build example --wait
appstorectl sync-metadata example --create-version
appstorectl submit example --yes
```

## Demo

- Pipeline diagram: [docs/assets/release-pipeline.svg](./docs/assets/release-pipeline.svg)
- Terminal ASCII walkthrough: [docs/demo.md](./docs/demo.md)
- Promo one-pager (Chinese): [docs/promo.md](./docs/promo.md)

```text
doctor → build → upload → attach → sync → submit
```

## Why this exists

The App Store Connect API can do a lot of the repetitive work, but a few things still fail in non-obvious ways:

- API Keys cannot create an app record (`POST /v1/apps` → 403)
- API Keys cannot Cloud-sign; export needs a local Distribution cert + `IOS_APP_STORE` profile
- `upload-build` does not attach the build to the version
- The first IPA sits in `PROCESSING` for minutes; `--build 1` may not match marketing version `1.0`
- App Privacy nutrition labels have no public write API and must be **Published** in the web UI
- The old `appStoreVersionSubmissions` create endpoint is gone

`appstorectl` turns those into commands you can re-run.

## Add your own app (keep it private)

```text
apps/myapp/appstore.config.json
apps/myapp/ExportOptions.plist
apps/myapp/metadata/en-US.json
apps/myapp/review-notes.md
apps/myapp/screenshots/APP_IPHONE_67/
profiles/me.json
```

Copy `apps/example` and `profiles/example.json`. The public `.gitignore` already ignores extra `apps/*` and `profiles/*` except the example, so adding your own app in a public clone is unlikely to be committed by mistake.

## Typical flow

```bash
appstorectl prepare-new-app myapp          # creates Bundle ID; tells you to create the app in the web UI
appstorectl inspect-app myapp
appstorectl ensure-store-profile myapp
appstorectl build myapp
appstorectl upload-build myapp
appstorectl list-builds myapp
appstorectl attach-build myapp --wait
appstorectl sync-metadata myapp --create-version
appstorectl sync-release-info myapp
appstorectl sync-pricing myapp
python3 ./scripts/prepare_screenshots.py \
  --source ~/Desktop/shots \
  --dest ./apps/myapp/screenshots/APP_IPHONE_67 \
  --display-type APP_IPHONE_67
appstorectl upload-screenshots myapp --replace
node ./scripts/asc_release_check.js --app myapp
# App Privacy in the web UI, then Publish
appstorectl submit myapp --yes             # refuses without --yes
```

iPhone-only screenshot slot is `APP_IPHONE_67` (1290×2796). iPad 13-inch is `APP_IPAD_PRO_3GEN_129` (2048×2732).

## Cursor skill

A drop-in agent skill lives in [`skill/SKILL.md`](./skill/SKILL.md). Copy it into your Cursor skills folder if you want the same release checklist in chat.

## Docs

- [docs/first-ios-app.md](./docs/first-ios-app.md) — first submission, agreement banner, waiting for PROCESSING
- [docs/review-submission.md](./docs/review-submission.md) — `reviewSubmissions` three-step flow
- [docs/signing.md](./docs/signing.md) — manual Distribution signing
- [docs/demo.md](./docs/demo.md) — terminal demo walkthrough
- [docs/promo.md](./docs/promo.md) — promo one-pager (Chinese)

## What this tool does not do

- Create the App Store Connect **app record** (web UI)
- Fill and **Publish** App Privacy labels (web UI)
- Invent a Distribution certificate if you do not have one locally

## License

MIT
