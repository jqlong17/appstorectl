# appstorectl

Local CLI for App Store Connect release work: archive with Xcode, upload an IPA, sync metadata, attach a processed build, and submit for review.

This repository is the **engine + an example app folder**. Put your real apps, review contacts, certificates, and screenshots in a private working copy. Do not commit them here.

本地命令行工具，用来走 App Store Connect 发版。这个仓库只有引擎和一份示例配置。你自己的 App、审核电话、证书和截图请放在私有目录，不要推到公开仓库。

## Why this exists

The App Store Connect API can do a lot of the repetitive work, but a few things still fail in non-obvious ways:

- API Keys cannot create an app record (`POST /v1/apps` → 403)
- API Keys cannot Cloud-sign; export needs a local Distribution cert + `IOS_APP_STORE` profile
- `upload-build` does not attach the build to the version
- The first IPA sits in `PROCESSING` for minutes; `--build 1` may not match marketing version `1.0`
- App Privacy nutrition labels have no public write API and must be **Published** in the web UI
- The old `appStoreVersionSubmissions` create endpoint is gone

`appstorectl` turns those into commands you can re-run.

## Install

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

## Add your own app (keep it private)

```text
apps/myapp/appstore.config.json
apps/myapp/ExportOptions.plist
apps/myapp/metadata/en-US.json
apps/myapp/review-notes.md
apps/myapp/screenshots/APP_IPHONE_67/
profiles/me.json
```

Copy `apps/example` and `profiles/example.json`. The public `.gitignore` already ignores extra `apps/*` and `profiles/*` except the example.

`.gitignore` 已经忽略除 `example` 以外的 `apps/` 和 `profiles/`。在公开克隆里加自己的 App 一般不会被误提交。

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

## What this tool does not do

- Create the App Store Connect **app record** (web UI)
- Fill and **Publish** App Privacy labels (web UI)
- Invent a Distribution certificate if you do not have one locally

## License

MIT
