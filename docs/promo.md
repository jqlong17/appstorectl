# appstorectl：给独立开发者的 App Store 发版 CLI

## 问题

独立做 iOS / macOS 的人，往往不是缺文档，而是缺一条**能反复跑完**的发版路径。

App Store Connect API 能做很多事，但坑是成套的：API Key 不能建 App 记录、不能 Cloud 签名；`upload` 不会自动挂构建；首包会卡在 `PROCESSING`；旧的 submission 接口已经下线；营养标签还得回网页 Publish。Fastlane 能覆盖全流程，但对「只想在本机 Mac 上稳定交一版」的人来说偏重，还要 Ruby 栈。

## 方案

**appstorectl** 是本地 Node CLI：用你自己的 ASC API Key + 本机 Xcode，把发版收成可重复命令。

```text
doctor → build → upload → attach → sync → submit
```

公开仓库只带引擎和 `apps/example`；真实 App、联系人、证书、截图放本机私有副本。

## 安装

```bash
npm i -g appstorectl
# 或
git clone https://github.com/jqlong17/appstorectl.git
cd appstorectl && npm link
```

需要 Node 20+、完整 Xcode.app、以及一把你自己的 App Store Connect API Key（`.p8` 不要进仓库）。

```bash
export ASC_ISSUER_ID="..."
export ASC_KEY_ID="..."
export ASC_PRIVATE_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

cp -R apps/example apps/myapp
# 编辑 apps/myapp/appstore.config.json 后：
appstorectl doctor myapp
```

更多流程见仓库 README；流程图：[assets/release-pipeline.svg](./assets/release-pipeline.svg)；终端演示：[demo.md](./demo.md)。

## 和 fastlane 比（很短）

| | appstorectl | fastlane |
| --- | --- | --- |
| 体量 | 单包 CLI，Node ≥20 | 完整 Ruby 工具链 |
| 场景 | 本机 Mac 发版闭环 | 大型 CI / 多平台自动化 |
| ASC 坑 | doctor / attach --wait 等写进命令 | 需自己拼 lane 与踩坑 |

不是替代 fastlane 的一切，而是给「一个人 + 一台 Mac」更轻的默认路径。

## 注意

- **必须有 Mac + Xcode**；云端 Linux agent 跑不了 archive / 签名。
- **必须用你自己的 ASC API Key**；仓库不提供、也不应提交 `.p8`。
- API Key **不能**创建 App 记录；**不能**代填并 Publish App Privacy。
- 公开帮助与示例一律用 `example`，不要把私有 App 名写进文档。

## 许可

MIT · https://github.com/jqlong17/appstorectl
