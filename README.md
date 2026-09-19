# appstorectl

[English](./README.en.md)

本地命令行工具，用来走 App Store Connect 发版：用 Xcode 打包、上传 IPA、同步元数据、挂上已处理完的构建，再提交审核。

这个仓库是**引擎 + 一份示例 App 目录**。你自己的 App、审核联系人、证书和截图请放在本机私有副本里，不要提交到这里。

## 为什么要做这个

App Store Connect API 能处理不少重复劳动，但有几处很容易踩坑：

- API Key **不能创建 App 记录**（`POST /v1/apps` 会返回 403）
- API Key **不能做 Cloud 签名**；导出 IPA 需要本机的 Distribution 证书，以及 `IOS_APP_STORE` 描述文件
- `upload-build` **不会**把构建挂到版本上
- 第一次上传的 IPA 会在 `PROCESSING` 里停几分钟；`--build 1` 也可能对不上营销版本号 `1.0`
- App Privacy（营养标签）**没有公开的写入接口**，必须在网页里填写并 **Publish**
- 旧的 `appStoreVersionSubmissions` 创建接口已经下线

`appstorectl` 把这些步骤收成可以反复执行的命令。

## 安装

```bash
git clone https://github.com/jqlong17/appstorectl.git
cd appstorectl
npm link
```

也可以直接在仓库里跑：

```bash
node ./bin/appstorectl.js --help
```

需要 Node 20+、完整的 Xcode.app，以及一把 App Store Connect API Key。

```bash
export ASC_ISSUER_ID="..."
export ASC_KEY_ID="..."
export ASC_PRIVATE_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

请把 `.p8` 也复制到 `~/.appstoreconnect/private_keys/`。`xcrun altool` 会去那里找密钥。永远不要把密钥提交进仓库。

## 加入你自己的 App（保持私有）

```text
apps/myapp/appstore.config.json
apps/myapp/ExportOptions.plist
apps/myapp/metadata/en-US.json
apps/myapp/review-notes.md
apps/myapp/screenshots/APP_IPHONE_67/
profiles/me.json
```

从 `apps/example` 和 `profiles/example.json` 复制一份即可。公开仓库的 `.gitignore` 已经忽略除 `example` 以外的 `apps/` 和 `profiles/`，在公开克隆里加自己的 App，一般不会被误提交。

## 常见流程

```bash
appstorectl prepare-new-app myapp          # 创建 Bundle ID；然后提醒你去网页新建 App
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
# 在网页里填 App Privacy，然后 Publish
appstorectl submit myapp --yes             # 没有 --yes 会拒绝提交
```

仅 iPhone 的截图槽位是 `APP_IPHONE_67`（1290×2796）。13 寸 iPad 是 `APP_IPAD_PRO_3GEN_129`（2048×2732）。

## Cursor skill

[`skill/SKILL.md`](./skill/SKILL.md) 里有一份可直接给 Agent 用的发版清单。需要的话，复制到你的 Cursor skills 目录。

## 文档

- [docs/first-ios-app.md](./docs/first-ios-app.md) — 第一次提交、协议横幅、等待 PROCESSING
- [docs/review-submission.md](./docs/review-submission.md) — `reviewSubmissions` 三步流程
- [docs/signing.md](./docs/signing.md) — 本机 Distribution 签名

## 这个工具不会做的事

- 创建 App Store Connect 上的 **App 记录**（请用网页）
- 填写并 **Publish** App Privacy 标签（请用网页）
- 在本机没有 Distribution 证书时，替你凭空造一张

## 许可证

MIT
