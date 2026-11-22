# Youtube Leaks

An Express 5 video site with a React JSX app, Vite, and Socket.IO. It starts in free mode with a local catalog of sample clips about publicly reported creator disputes and court cases. Each sample links to its source. The silent previews use original, generated illustrations. Production starts with an empty catalog.

## Developer mode on Mac and Windows

Install [Git](https://git-scm.com/install/) and [Node.js 24 LTS](https://nodejs.org/en/download), version 24.14 or newer. For video uploads and RSS imports, install [FFmpeg](https://ffmpeg.org/download.html) and make sure both `ffmpeg` and `ffprobe` are on your PATH.

Clone the repository from Terminal on Mac or PowerShell on Windows:

```sh
git clone https://github.com/xander113/youtube-leaks.git
cd youtube-leaks
```

On Mac:

```sh
npm ci
npm run dev
```

On Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). On the first start, the terminal shows the password for `admin@example.test`. Keep it to sign in as Head Admin. SQLite creates the database and seeds the sample catalog when the app starts.

On Mac you can also open `setup.command`, and on Windows you can double-click `setup.cmd`. Both install the locked dependencies and start the app. With Docker Desktop running, use `docker compose up -d redis` for shared limits and live updates from Redis. The local app can also run without Docker using single-process live updates. If port 3000 is in use, try `npm run dev -- --port 3001`.

To set the first admin login, configure `HEAD_ADMIN_EMAIL` and `HEAD_ADMIN_PASSWORD` in your terminal before the first start. Choose a password of at least 12 characters. The seed keeps the stored login on later runs. GitHub Actions installs, builds, and runs the access tests on macOS, Windows, and Linux.

Guests can view the free clips. Use **Make an account** on the sign-in screen to try Watcher access, playlists, replies, and help. The sample previews use illustrated placeholder footage. Add media you have permission to publish.

## Admin and RSS

The Admin page handles video uploads, series, guest flags, Watcher bans, feed imports, and help replies. Upload an MP4, MOV, or WebM file up to 250 MB by default and under one hour. The queue makes browser-ready video in the background, creates its poster, and updates the page once it finishes. A failed upload can be retried or removed. The worker checks its installed encoders and uses H.264/AAC or falls back to VP8/VP9 WebM. It creates JPEG, PNG, or WebP posters based on codec availability. Install a full FFmpeg build if a codec is missing. Set `FFMPEG_PATH` or `FFPROBE_PATH` if the tools are installed outside your PATH. Restart the worker before retrying a clip after changing FFmpeg. Video date controls chronological series. The RA label marks a series set to upload order.

Set `RSS_ALLOWED_HOSTS` to a comma-separated list of exact hostnames for approved feeds and their video files. The importer accepts HTTPS RSS, Media RSS, and Atom entries with direct MP4, MOV, or WebM enclosures. It skips video page links and expects direct downloads without redirects. Feeds check every 15 minutes and import up to four new entries per run. Use **Check now** to queue a check. New files enter the same video queue as uploads. Guest access defaults to off.

## Production with Docker Compose

The production stack uses Caddy for HTTPS and WebSocket proxying, Express for the app, PostgreSQL for data, and Redis for shared rate limits and Socket.IO events. A separate worker runs video encoding and RSS imports. The edge is the only service with published ports. Media lives in a private volume mounted by the worker and every app replica.

1. Install Docker with the Compose plugin. Point your domain at the host and allow Caddy to receive traffic on ports 80 and 443.
2. Set the variables below in your service manager or export them from your shell. The database and Redis passwords go in connection URLs. Use strong URL-safe values, such as separate outputs from `openssl rand -hex 32`.
3. Build and start the stack:

   ```sh
   docker compose -f compose.production.yaml build app worker
   docker compose -f compose.production.yaml up -d --scale app=2 --wait
   ```

4. Open the URL in `APP_ORIGIN`. The one-time migration service applies the schema and creates the Head Admin. The app starts with an empty catalog.

| Required variable | Use |
| --- | --- |
| `APP_ORIGIN` | The public HTTPS origin, such as `https://watch.example.com`, with no trailing slash or path. |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Separate strong URL-safe passwords for the private containers. |
| `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_PASSWORD` | The initial admin login. The password must have at least 12 characters. Required when initializing a new database. |

### Run on your own services

For a deployment with managed databases or a different reverse proxy, use Node.js 24 LTS and install FFmpeg. Run `npm ci` and `npm run build`. Set `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `APP_ORIGIN`, and the initial admin credentials. Run `npm run db:migrate` and `npm run db:seed` once. Run `npm start` under a service manager. Route HTTP, ranges, and WebSocket upgrades to the same app port. Mount the same private media storage on all app and worker nodes.

| Optional variable | Use |
| --- | --- |
| `PORT`, `HOST` | App listener. Defaults to port 3000 and loopback in development. Production listens on all interfaces. |
| `PG_POOL_MAX` | Maximum PostgreSQL connections per app or worker process. The default is 15. |
| `DATA_DIR`, `MAX_UPLOAD_MB` | Private shared media path and upload cap. The default cap is 250 MB. |
| `RUN_JOBS` | Set to `0` on web-only processes. Keep at least one process running the queue. Compose sets this for you. |
| `CORS_ORIGINS` | Comma-separated extra origins. Set `CROSS_SITE_COOKIES=1` for credentialed cross-site clients over HTTPS. Browser cookie rules still apply. |
| `TRUST_PROXY` | Trusted proxy addresses or CIDR ranges. Trust only proxies you control. Compose uses the private Docker network. |
| `RSS_ALLOWED_HOSTS` | Comma-separated exact hostnames for feeds and their media. |

### Scale and monitor

- Increase `--scale app=2` to add web replicas. Increase `--scale worker=1` independently if video encoding falls behind. For several hosts, use a load balancer, shared private media storage, PostgreSQL, and Redis. Count each process’s connection pool toward the database connection budget.
- Monitor `/api/health/live` and `/api/health/ready`, response latency, WebSocket reconnects, queue delay, database pool saturation, and media bandwidth. Private playback supports single byte ranges and sends a no-store cache policy.
- Place production behind your provider’s DDoS protection and preserve client IP forwarding from trusted proxies. Size storage and network throughput by the bitrate and expected number of video streams. The local load tests check concurrent API and live connections. Run a separate load test with your production videos and infrastructure.

## Turn on paid mode

In developer mode, sign in as Head Admin and enable **Dummy paid**. Watchers see the normal Plans page and can complete testing, change plans, or cancel with the built-in checkout. The test card is fixed and dummy payments never reach Stripe.

In either mode, an administrator can set a Watcher to **Paid · Basic**, **Paid · Premium**, or **Unpaid** in the admin panel. Choose **Use subscription** to restore the tier from billing. Overrides affect app access. They leave any Stripe subscription and charges as they are.

### Stripe in production

Create four recurring USD prices in Stripe. Configure the Stripe customer portal for plan changes and cancellation. Set each price ID on the server.

| Plan | Per month | Per year | Price variables |
| --- | ---: | ---: | --- |
| Basic | $2.99 | $35.88 | `STRIPE_BASIC_MONTHLY`, `STRIPE_BASIC_YEARLY` |
| Premium | $4.99 | $59.88 | `STRIPE_PREMIUM_MONTHLY`, `STRIPE_PREMIUM_YEARLY` |

Set `STRIPE_SECRET_KEY` and the endpoint's `STRIPE_WEBHOOK_SECRET`. Deliver the following Stripe events to `POST /api/stripe/webhook`.

- `checkout.session.completed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `customer.subscription.paused`, `customer.subscription.resumed`
- `invoice.paid`, `invoice.payment_failed`

Sign in as user ID 1 and select **Switch to paid**. The server checks the Stripe prices before enabling paid mode. Checkout and the billing portal are hosted by Stripe. Signed events update access on the server. Basic can watch up to HD and use comments and playlists. Premium can also choose the highest source quality up to 4K, preloads video when the browser allows it, and puts new help messages first in the queue. In paid mode, comments show the account's active tier. Turning on free mode opens videos to every Watcher. Existing Stripe subscriptions stay active until canceled. Watchers with billing accounts can still reach **Manage plan**.

Use Stripe test mode for a checkout and billing portal check before accepting payments. The included tests cover local access rules and live updates. The project was also checked in Chromium at phone and desktop widths and against PostgreSQL and Redis. A local concurrency check used 1,050 connected sockets and 1,200 concurrent HTTP reads. Real payment processing and sustained video load depend on your deployment.

## Database commands and source

- `npm run db:migrate` applies the schema. `npm run db:seed` initializes the required admin and mode settings.
- `npm run db:refresh` recreates the local database and seeds it. Stop the app first. This erases local accounts and the catalog. Back up the database and media directory together when needed.
- SQLite applies the checked-in schema and sample SQL on startup. Production uses `database/migrations` and `database/production-seed.sql`. Run `npm run db:migrate` before starting an updated production app.
- The web routes are in `routes/web.js`, HTTP API in `routes/api.js`, and Socket.IO in `routes/socket.js`. Models, controllers, and services are in `app/`.
- The React entry renders `@/Root`, which exports the starter layout. To replace the starter layout and navigation, retain the `usePage().props` contract and the router outlet.
- `npm test` runs the local access test. `npm run build` makes the production frontend.

Implementation references are the official [Express production guide](https://expressjs.com/en/advanced/best-practice-security/), [Vite server options](https://vite.dev/config/server-options), [Socket.IO Redis adapter guide](https://socket.io/docs/v4/redis-adapter/), [Stripe subscription webhooks guide](https://docs.stripe.com/billing/subscriptions/webhooks), and [FFmpeg formats documentation](https://ffmpeg.org/ffmpeg-formats.html).
