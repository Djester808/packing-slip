# Weather hold notice release

Published September 23, 2026 to the existing `pack-slip` Fly.io app.

The notice offers waiting without replying or pickup at an official UPS Store. It displays the next Sunday, Monday, or Tuesday 4 PM America/Chicago recheck and the following shipping day/date, uses best-effort shipping wording, and identifies the email as automated. The reply link URL-encodes the order number. No AI is involved.

## Verification

- 54 focused tests passed across the actual weather-email sender (mock transport), weather policy, and hold workflow.
- Production build passed locally and on the Fly builder.
- Actual production template checked in a browser at 390 and 1280 pixels, including the pickup button and footer.
- The deployed template functions were rendered inside an isolated VM using synthetic inputs. Recheck date, shipping date, automated label, no-reply wording, and encoded order number all passed.
- The live app and public endpoint return the expected HTTP 302 authentication redirect. No customer email was sent as a test.

## Deployment and records

Image: `registry.fly.io/pack-slip:weather-notice-cf20d33`

Image digest: `sha256:56433a3263effdd7ad113299c168c564ab24623c22df98aa179bec472eaeccee`

Active machine: `7845340a1e5228`. Older machines are stopped and cordoned. Until they are retired, scope subsequent deployments to the active machine so an empty independent SQLite instance cannot enter service.

The existing SQLite database previously lived on ephemeral disk. It was copied directly within the app's private Fly network to the encrypted `packing_data` volume, mounted at `/data`. Database path: `file:/data/dev.db`. The transfer receiver had no public services, allowed only the original machine, accepted one successful copy, and was removed from the running configuration afterward. Database contents and credentials were not exported locally or included in the image upload.

Checksums matched before startup; SQLite integrity checks passed before and after startup. Retained counts: 16 transit rules, 473 weather cache rows, 1 settings row, 381 transit cache rows, and 24 sent-email records. There were no session rows.

The existing Fly credential was valid; it was supplied only to the deployment subprocess through `FLY_API_TOKEN`. No new account link or token was needed.

## Rollback

Use the previous image on the active volume-backed machine and keep `DATABASE_URL=file:/data/dev.db`. Do not restart the old ephemeral-database machines into public service. Do not include database files in source or image uploads. The source repository's Docker ignore rules now exclude database, environment, credential, and log files.

Previous image: `registry.fly.io/pack-slip:deployment-01M278BFDKHRBKRW94X73K3SNB`.

This verifies deployment and template rendering, not an actual customer mail delivery or a completed scheduled production weather run.
