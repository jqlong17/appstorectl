# Submitting for review

Apple retired `POST /v1/appStoreVersionSubmissions`. Use the three-step `reviewSubmissions` flow. The CLI `submit --yes` command already does this:

1. `POST /v1/reviewSubmissions` (hang the app, set `platform`)
2. `POST /v1/reviewSubmissionItems` (hang the app Store version)
3. `PATCH` the submission with `submitted: true`

If an open submission already exists, reuse it.

## Export compliance

Step 2 can fail with `usesNonExemptEncryption` required. The CLI sets `false` on the attached build when the field is still `null` (typical for HTTPS-only apps). Also set `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` in Xcode.

## Do not submit without `--yes`

`submit` without `--yes` only prints the dry-run requests.
