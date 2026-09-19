# Signing and export

App Store Connect API Keys cannot Cloud-sign. Automatic export often fails with:

```text
Cloud signing permission error
No profiles for 'com.example.myapp' were found
```

Use a local Apple Distribution certificate and an `IOS_APP_STORE` profile:

```bash
node ./bin/appstorectl.js ensure-store-profile example
```

Point `xcode.developerDir` at full Xcode.app, not Command Line Tools.

If archive succeeded and only export failed:

```bash
node ./bin/appstorectl.js build example --export-only
```

`ExportOptions.plist` should use `signingStyle = manual` and map your bundle ID to the profile name.
