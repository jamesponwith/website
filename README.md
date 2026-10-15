# phux website

[phux.sh](https://phux.sh) and [docs.phux.sh](https://docs.phux.sh).

The product source stays in [no-phux/phux](https://github.com/no-phux/phux).
This repo builds and deploys the site. A build checks out phux and copies the
docs, the curl installers, and the product skills. It does not keep a second
copy of them.

Locally, put the phux checkout at `../../phux` (this repo lives at
`no-phux/website`) or `../phux`, or set `PHUX_ROOT`.

```sh
bun install
bun run dev
```

Deploy and the worker are in [DEPLOY.md](./DEPLOY.md). Cloudflare credentials
are repository secrets on this repo (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `PHUX_SYNTHETIC_TOKEN`) plus the `PUBLIC_PHUX_DEMO_WS`
variable.

[Apache-2.0](./LICENSE). Copyright 2026 phall.
