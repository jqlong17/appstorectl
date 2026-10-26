# Demo walkthrough / 演示走查

Terminal-only demo (no App Store Connect UI screenshots). Replace `example` with your local app folder name.

Pipeline diagram: [assets/release-pipeline.svg](./assets/release-pipeline.svg)

```text
doctor → build → upload → attach → sync → submit
```

## ASCII session

```text
$ npm i -g appstorectl
$ export ASC_ISSUER_ID=... ASC_KEY_ID=... ASC_PRIVATE_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_....p8
$ export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

$ appstorectl doctor example
✓ Node >= 20
✓ ASC env present
✓ Xcode developerDir
✓ ExportOptions.plist
✓ Distribution cert serial matches config
doctor: ok

$ appstorectl build example
▸ xcodebuild archive …
▸ xcodebuild -exportArchive …
✓ IPA → build/example/export/ExampleApp.ipa

$ appstorectl upload-build example
▸ xcrun altool --upload-app …
✓ Upload accepted (build is NOT attached yet)

$ appstorectl list-builds example
  #1  1.0 (1)  PROCESSING
  … wait a few minutes …

$ appstorectl attach-build example --wait
▸ polling until VALID …
✓ Attached build 1 to version 1.0

$ appstorectl sync-metadata example --create-version
$ appstorectl sync-release-info example
$ appstorectl sync-pricing example
✓ Locale / review / pricing synced

$ appstorectl submit example --yes
✓ reviewSubmission created → item added → submitted
```

## 中文要点

1. **doctor** — 先查本机证书、环境变量和配置，别一上来就 archive。
2. **build / upload** — 本机 Distribution 签名；上传成功 ≠ 挂到版本。
3. **attach --wait** — 等 `PROCESSING` 结束再挂构建。
4. **sync*** — 元数据、审核联系人、定价；截图另走 `upload-screenshots`。
5. **submit --yes** — 没有 `--yes` 会拒绝提交；App Privacy 仍须在网页 Publish。
