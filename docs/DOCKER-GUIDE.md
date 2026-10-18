# DOCKER-GUIDE.md — Running Wasfa AI on a server

A step-by-step guide for someone who has **never used Docker**. Every command can be copied as it
is. If a step says "console", it is done with the mouse in the AWS / Cloudflare / GitHub website.

> Related files: `infra/docker/` (the stack), `infra/scripts/` (provision, deploy, backup, restore),
> `.github/workflows/` (CI/CD), `.env.example` (every setting). Rules and architecture:
> `AGENT.md`, `ARCHITECTURE.md`.

---

## 1. The five words you need

| Word | What it is | Everyday comparison |
|---|---|---|
| **Image** | A frozen, ready-to-run copy of a program with everything it needs. We build three of our own (`web`, `api`, `worker`), plus a `backup` tool image. | A recipe card |
| **Container** | One running copy of an image. You can stop it, start it, delete it; the image stays. | A dish made from the recipe |
| **Compose** | A text file (`compose.prod.yml`) that lists all containers and how they connect. One command starts them all. | The menu for the whole meal |
| **Volume** | A folder that survives when a container is deleted. The database lives in one. | The fridge |
| **Network** | A private road between containers. | The kitchen corridor |

Containers are disposable. **Volumes (the database) and `.env.prod` (the secrets) are not**, and
that is why backups exist (section 7).

## 2. How the pieces fit

```
Visitor ──▶ Cloudflare (DDoS filter, WAF, TLS) ──▶ the server, port 443, only from Cloudflare
                                                      │
                                                  [ caddy ]      the only container with open ports
                                                   │      │
                                        wasfa.online│      │api.wasfa.online
                                                [ web ]   [ api ] ────┐
                                           (Next.js site)  (NestJS)   │   private network "internal"
                                                                      ├──▶ [ postgres ]   database
                                              [ worker ] ─────────────┴──▶ [ redis ]      queues, limits
                                              (background jobs)
```

| Container | Job | Can reach the internet? | Data kept |
|---|---|---|---|
| `caddy` | HTTPS, security headers, routes by domain | yes (it is the front door) | its certificates |
| `web` | The website | yes (no need, but not blocked) | none |
| `api` | All business logic | yes (will call AI/payment providers) | none |
| `worker` | Background jobs: outgoing email, account anonymization, expired-session purge. It needs the database too, as the same restricted role as the api (no new secret: it reuses `API_DB_PASSWORD`) | outbound only, for the mail relay (nothing is published) | none |
| `postgres` | The database | **no** | `postgres-data` volume |
| `redis` | Queues and rate limits | **no** | `redis-data` volume |
| `backup` | Nightly encrypted backup (runs for a minute, then exits) | yes (to reach R2) | none |

Only Caddy publishes ports (80 and 443). Postgres and Redis publish **nothing**: nobody outside
the server can even try to connect. Web, api and worker run as an unprivileged user with a
**read-only** file system and no Linux capabilities.

---

## 3. One-time setup (do these in order)

You need: a domain on Cloudflare, an AWS account, a GitHub account with this repository, a
Cloudflare R2 bucket (for backups), and a laptop with `ssh`.

### 3.1 AWS: the server

**Console steps**

1. **EC2 → Launch instance.** Name `wasfa-prod`. Image: **Ubuntu Server 24.04 or 26.04 LTS** (both are supported by `provision.sh`). Type:
   **t3.medium** (2 vCPU, 4 GB; the container limits in `compose.prod.yml` are sized for it).
   Storage: **30 GB gp3**. Key pair: create one (`wasfa-prod.pem`), keep it safe.
   Under *Advanced details* set **Metadata version = V2 only** and enable **Termination protection**.
2. **Elastic IP.** EC2 → Elastic IPs → Allocate → Associate with the instance. This is the
   server's permanent address (without it the address changes on every stop/start).
3. **Security group** (the instance's firewall, outside the server). Replace the default rules:

   | Type | Port | Source |
   |---|---|---|
   | SSH | 22 | **My IP** (your address as `x.x.x.x/32`) |
   | HTTPS | 443 | Cloudflare ranges only (below) |
   | HTTP | 80 | Cloudflare ranges only |

   Outbound: allow all (default). **Never** open 5432 (Postgres) or 6379 (Redis).

   Without ports 80/443 open here, Cloudflare shows error **522** even though the server is healthy.
   **Attach an Elastic IP** before anything else: a plain public IP changes on every stop/start and
   would break DNS and the `DEPLOY_HOST` secret.

   Cloudflare publishes its ranges at <https://www.cloudflare.com/ips-v4> and `/ips-v6`. With the
   AWS CLI (replace `sg-xxxx`):

   ```bash
   SG=sg-xxxx
   for cidr in $(curl -fsS https://www.cloudflare.com/ips-v4); do
     for port in 80 443; do
       aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port "$port" --cidr "$cidr"
     done
   done
   # IPv6 ranges: --ip-permissions "IpProtocol=tcp,FromPort=443,ToPort=443,Ipv6Ranges=[{CidrIpv6=$cidr}]"
   ```

   A home IP changes. If you lock yourself out of SSH, change the rule in the console. Better:
   use **AWS Systems Manager Session Manager** (attach the `AmazonSSMManagedInstanceCore` role,
   then close port 22 completely).
4. **Billing alarm** (so a mistake never becomes a surprise bill). Billing → Billing preferences →
   tick *Receive CloudWatch billing alerts*. Then, in region **us-east-1**:

   ```bash
   aws sns create-topic --name billing-alerts --region us-east-1
   aws sns subscribe --region us-east-1 --topic-arn <ARN-from-above> --protocol email --notification-endpoint you@example.com
   aws cloudwatch put-metric-alarm --region us-east-1 --alarm-name wasfa-monthly-bill \
     --namespace AWS/Billing --metric-name EstimatedCharges --dimensions Name=Currency,Value=USD \
     --statistic Maximum --period 21600 --evaluation-periods 1 --threshold 60 \
     --comparison-operator GreaterThanThreshold --alarm-actions <ARN-from-above>
   ```

   Confirm the e-mail AWS sends you. Pick a threshold about 30% above what you expect to pay.

### 3.2 The server: `provision.sh`

From your laptop, copy the script and your **deploy keys** to the server. The *deploy key* is a
key pair used only by GitHub Actions; create it now:

```bash
ssh-keygen -t ed25519 -N "" -C wasfa-deploy -f wasfa-deploy      # makes wasfa-deploy and wasfa-deploy.pub
cat wasfa-deploy.pub ~/.ssh/id_ed25519.pub > deploy_keys.pub    # both may log in as `deploy`
scp -i wasfa-prod.pem infra/scripts/provision.sh deploy_keys.pub ubuntu@<ELASTIC-IP>:~
ssh -i wasfa-prod.pem ubuntu@<ELASTIC-IP>
```

On the server, first **look** at what it will do (changes nothing), then run it:

```bash
sudo OWNER_IP_CIDR=<your.ip>/32 DEPLOY_AUTHORIZED_KEYS_FILE=$HOME/deploy_keys.pub ./provision.sh --dry-run
sudo OWNER_IP_CIDR=<your.ip>/32 DEPLOY_AUTHORIZED_KEYS_FILE=$HOME/deploy_keys.pub ./provision.sh
```

It does, in this order: UTC clock, updates; automatic **security updates** (reboots at 03:30 UTC if a
kernel update needs it, set `AUTO_REBOOT=0` to disable); the `deploy` user (SSH key only, no sudo);
**SSH hardening** (no root, no passwords, only `ubuntu` and `deploy`); the firewall (**UFW** plus
Docker's own `DOCKER-USER` chain, ports 80/443 only from Cloudflare, refreshed weekly); **fail2ban**;
a **swap file** sized to the RAM; **Docker Engine + Compose** from Docker's official repository (log
rotation on); the folder layout; the **nightly backup timer**.

> **Why two firewalls?** UFW alone does *not* protect Docker ports (Docker edits the firewall
> itself). The script therefore also filters Docker's chain. The AWS security group is the main
> wall, and Caddy additionally demands Cloudflare's certificate (section 3.3), so a request that
> bypasses Cloudflare is stopped three times.

**Before closing the terminal**, open a *second* terminal and check:

```bash
ssh -i wasfa-prod.pem ubuntu@<ELASTIC-IP>     # must still work
ssh root@<ELASTIC-IP>                         # must be refused
ssh -o PubkeyAuthentication=no ubuntu@<ELASTIC-IP>   # must be refused (no passwords)
```

The server now has `/opt/wasfa/` with `certs/` (700), `backups/` (700) and an empty `.env.prod` (600).

### 3.3 Cloudflare

All in the Cloudflare dashboard for your domain. Order matters a little: do DNS first, TLS next.

1. **DNS → Records.** Three **A** records, **Proxied (orange cloud)**, all pointing to the Elastic IP:
   `@` (wasfa.online), `www`, `api`. (Grey cloud would expose the real IP and skip every protection.)
2. **SSL/TLS → Overview:** mode **Full (strict)**.
3. **SSL/TLS → Origin Server → Create Certificate.** RSA, hostnames `wasfa.online` and
   `*.wasfa.online`, 15 years. Copy the two boxes into files on the server:

   ```bash
   sudo -u deploy nano /opt/wasfa/certs/origin.pem     # paste "Origin Certificate"
   sudo -u deploy nano /opt/wasfa/certs/origin.key     # paste "Private Key" (shown only once)
   curl -fsS https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem \
     | sudo -u deploy tee /opt/wasfa/certs/cloudflare-origin-pull-ca.pem >/dev/null
   sudo chmod 600 /opt/wasfa/certs/origin.key
   ```
4. **SSL/TLS → Origin Server → Authenticated Origin Pulls: ON.** Cloudflare now presents a client
   certificate and Caddy refuses everyone else (that is what `caddy/tls.prod.caddy` enforces).
   Use the zone-wide switch (API: `PATCH /zones/<id>/settings/tls_client_auth` = `on`). The separate
   "per-hostname / custom certificate" mode (`origin_tls_client_auth`) presents nothing Caddy trusts and
   shows up as Cloudflare error **520**.
5. **SSL/TLS → Edge Certificates:** *Always Use HTTPS* ON; *Minimum TLS Version* 1.2; *TLS 1.3* ON;
   *Automatic HTTPS Rewrites* ON; **HSTS** ON (max-age 12 months or more, include subdomains,
   preload). Caddy sends the same header, so both agree.
6. **Security → Bots → Bot Fight Mode:** ON.
7. **Security → WAF → Managed rules:** enable the **Cloudflare Managed Ruleset** (free).
8. **Security → WAF → Rate limiting rules.** The free plan allows **one** rule, so one combined rule:
   - Expression (edit as text):
     `http.host eq "api.wasfa.online" and (starts_with(http.request.uri.path, "/auth/") or starts_with(http.request.uri.path, "/ai/"))`
   - Same IP; **30 requests per 10 seconds**; action **Block** for 10 seconds.
   - On a paid plan, make two rules with their own limits (login attempts are much stricter than AI calls).
9. **Caching → Cache Rules:**
   - *Bypass cache* when `http.host eq "api.wasfa.online"`.
   - *Eligible for cache* when `http.host eq "wasfa.online" and starts_with(http.request.uri.path, "/_next/static/")`, Edge TTL "Use cache-control header from origin".
   - HTML pages are not cached on purpose: each response carries a one-time security token (the CSP nonce).

### 3.4 Cloudflare R2: the backup bucket

1. **R2 → Create bucket** `wasfa-backups`. Leave it **private**: never enable the public `r2.dev` URL or a custom domain.
2. **R2 → Manage API tokens → Create API token:** permission *Object Read & Write*, **only** bucket
   `wasfa-backups`. Write down *Access Key ID*, *Secret Access Key* and your *Account ID* (shown on the R2 page).
3. Optional safety net: bucket → Settings → Object lifecycle → delete objects older than 70 days.

### 3.5 The backup key (do this on your laptop, not the server)

```bash
age-keygen -o wasfa-backup.key        # install age first: https://github.com/FiloSottile/age
# prints:  Public key: age1xxxxxxxx...
```

- The **public key** (`age1…`) goes into `.env.prod` as `BACKUP_AGE_PUBLIC_KEY`. It can only *lock*.
- The file `wasfa-backup.key` is the **private key**. It is the only thing that can *unlock* a
  backup. Keep it **offline**: a password manager *and* a printed copy somewhere safe. **Never put
  it on the server.** If you lose it, every backup is unreadable garbage.
- Also store `ENCRYPTION_KEY` (from `.env.prod`) in the same safe place: stored API keys in the
  database cannot be decrypted without it, even after a perfect restore.

### 3.6 GitHub

1. **Settings → Environments → New environment `production`.** Optionally add yourself as a *required
   reviewer* so every deploy needs a click. Add these **environment secrets**:

   | Secret | Value |
   |---|---|
   | `DEPLOY_HOST` | the Elastic IP |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | the content of the private file `wasfa-deploy` |
   | `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <ELASTIC-IP>` (pins the server, so nobody can impersonate it) |

2. **Protect `main`** (once, needs the GitHub CLI logged in as an admin): `./infra/scripts/protect-main.sh`.
   After that a pull request cannot be merged until both CI checks pass, and nobody can force-push.
3. Packages (the images) are private by default, which is what we want. The deploy workflow logs the
   server in to GHCR with its own short-lived token, so no password is stored on the server.

### 3.7 The settings file `.env.prod`

On the server, as `deploy` (`sudo -u deploy -i`), open `/opt/wasfa/.env.prod` and fill it from
`.env.example` (the "Production stack" and "Backups" parts). Generate each secret with:

```bash
openssl rand -hex 24        # POSTGRES_PASSWORD, REDIS_PASSWORD, API_DB_PASSWORD (hex only: they are placed inside URLs)
openssl rand -base64 32     # ENCRYPTION_KEY
openssl rand -base64 48     # BETTER_AUTH_SECRET (signs session cookies; rotating it signs everyone out)
```

Authentication also needs these in `.env.prod` (the API refuses to start in production without the
first two; see `.env.example` for what each one does):

| Key | Where it comes from |
|---|---|
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard → Turnstile → your widget → **Secret key** (the **site key** is public and goes to the web app in Task 1.9). Required. |
| `AUTH_COOKIE_DOMAIN` | `.wasfa.online` (the default). Must cover both `wasfa.online` and `api.wasfa.online`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud console → APIs & Services → Credentials → OAuth client (Web). Authorized redirect URI: `https://api.wasfa.online/auth/callback/google`. Optional until you want Google sign-in; set both or neither. |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | Leave empty: Facebook ships as "coming soon". |
| `API_DB_PASSWORD` | **New (Task 1.6), required.** Password of the restricted database role `wasfa_api` that the api and the WhatsApp bridge use. The deploy's `migrate` step creates the role and sets this password, so add it to `.env.prod` **before** the next deploy; compose refuses to start without it. |
| `ARGON2_MEMORY_KIB` | Optional, default 19456. |
| `SMTP_USER`, `SMTP_PASS` | Brevo dashboard → **SMTP & API** → SMTP: the **login** shown there and an **SMTP key** you generate (not the API key). Both required: the worker will not start in production without them, and mail is never "captured" there. |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_DAILY_CAP` | Optional. Defaults: `smtp-relay.brevo.com`, `587`, `"وصفة AI" <no-reply@wasfa.online>`, `280` (a margin under Brevo's 300 a day). Changing provider is these variables only. |
| `ALERT_TELEGRAM_BOT_TOKEN` | **Phase 3.** The bot that sends admin alerts (payments to review, withdrawals, reconcile drift). Compose defaults it to the backup bot's token; each admin sets their own Telegram chat id in their alert preferences. |
| `API_DOMAIN` | **Phase 3.** Optional, default `api.wasfa.online`. Compose turns it into `API_PUBLIC_URL` for the api and the worker: the Kashier webhook URL (`https://<API_DOMAIN>/webhooks/kashier`) and the one-click unsubscribe target of lifecycle mail (`https://<API_DOMAIN>/unsubscribe`). Nothing secret. |

**Payment gateway keys are not environment variables.** Kashier's merchant id and keys are entered
in the admin (`/admin/billing/gateways`), stored encrypted with `ENCRYPTION_KEY`, and verified with
a real test payment before the card method can be switched on.

**Cloudflare and gateway webhooks (Phase 3).** Kashier calls `POST https://api.wasfa.online/webhooks/kashier`
from its own servers. After the first deploy, open Cloudflare → Security → Events and check that a
test webhook was not blocked or challenged; if it was, add a WAF **skip** rule for the path
`/webhooks/*` (skip managed rules and bot fight mode only; the API still verifies every signature).
Caddy needs no change: the API's 1 MB body limit already covers webhook bodies.

**Brevo state (2026-10-10, set up through the Brevo MCP):** free plan, 299 sends/day; SMTP login
`bd8752001@smtp-brevo.com` on `smtp-relay.brevo.com:587` (the SMTP **key** can only be created in the
dashboard: SMTP & API > SMTP > Generate). Domain `wasfa.online` **authenticated** and sender
`"وصفة AI" <no-reply@wasfa.online>` **active**; a test mail through the relay with the production key
was accepted (`250 2.0.0 OK`). The SMTP settings are in the server's `.env.prod`. DNS records Brevo requires, all
**DNS only** in Cloudflare:

| Type | Name | Value |
|---|---|---|
| CNAME | `brevo1._domainkey` | `b1.wasfa-online.dkim.brevo.com` |
| CNAME | `brevo2._domainkey` | `b2.wasfa-online.dkim.brevo.com` |
| TXT | `@` | `brevo-code:8d0e2ab2236b6d1d5dd2fcead71d939f` |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:rua@dmarc.brevo.com` |
| TXT | `@` (edit the existing SPF) | `v=spf1 include:spf.efwd.registrar-servers.com include:spf.brevo.com ~all` |

**Email deliverability (owner, once, Task 1.4).** In Brevo → **Senders, domains & dedicated IPs → Domains**,
add `wasfa.online` and create the DNS records Brevo shows in Cloudflare (DNS only, not proxied): the
Brevo verification code (TXT), the **DKIM** record(s), and an **SPF** record that includes Brevo
(`v=spf1 include:spf.brevo.com ~all`, merged into the existing SPF record if there is one). Then add a
**DMARC** record: TXT `_dmarc` = `v=DMARC1; p=quarantine; rua=mailto:dmarc@wasfa.online; adkim=s; aspf=s`.
After the first deploy, send a verification mail to the address shown on <https://www.mail-tester.com>
(register on the site with that address); the score should be **9/10 or better**. Also check on the
Brevo dashboard whether the free plan adds Brevo branding to transactional mail, and tell the agent so
it is recorded in `docs/phases/phase1.md`.

Then `chmod 600 /opt/wasfa/.env.prod`. Never paste its content into chat, tickets or commits.

### 3.8 First deploy

Push to `main` (or **Actions → Deploy → Run workflow** with a commit SHA that has images). The
workflow copies the config to `/opt/wasfa`, pulls the images, runs the database migrations, starts
everything and waits up to 60 s for `/health/ready`. **If the new version is not healthy it puts the
previous one back and the job fails.**

Check it from your laptop:

```bash
curl -I https://wasfa.online/                     # 200, with security headers
curl https://api.wasfa.online/health/live         # {"status":"ok"}
curl https://api.wasfa.online/health/ready        # {"status":"ok"}
curl -m 5 -k https://<ELASTIC-IP>/                # must FAIL: the server refuses direct access
```

Once, load the default site settings:
`dc --profile tools run --rm migrate node node_modules/@wasfa/db/dist/seed.js` (it never overwrites
values an admin has edited).

---

### 3.9 Link the WhatsApp number (phone verification, Task 1.5)

Phone verification works by users **sending** a code from their own WhatsApp to ours, so it needs a
dedicated WhatsApp (Business) number, **never your personal one**, with a complete business profile
(name, logo, description, website) and an auto-greeting set in the phone app. Use the number for a few
days like a normal business line before linking it.

Linking is done from the admin panel; no env var or server command is needed any more.

1. Make sure the `wa-bridge` service is running (`dc up -d wa-bridge`). It idles and reports
   "logged out" until a number is linked. Check with `dc logs --tail 20 wa-bridge`.
2. Sign in to `/admin` (two-factor on), open **رقم واتساب** (`/admin/whatsapp`), pick the country, type
   the dedicated number and press **اطلب رمز الربط**. Re-enter your password if asked.
3. The page shows an 8-character pairing code with a countdown (about 3 minutes). On the phone:
   WhatsApp Business > Settings > Linked devices > Link a device > **Link with phone number instead**,
   and type the code. The phone stays the primary device. The page turns to "linked" by itself and the
   status card shows **متصل** (connected). The number is saved as the `whatsapp` site setting.
4. If WhatsApp ever logs the device out, the bridge stops and says so (status **غير مرتبط**); phone
   verification hides itself and email verification keeps working. Link again from the same page (a
   logged-out session is replaced). To switch numbers while one is linked, press **فك الربط** first. The
   bridge never re-pairs by itself.
   Fallback if the admin is unreachable: `dc run --rm wa-bridge node dist/wa-bridge/main.js link 2015XXXXXXXX`
   prints the code in the terminal, and `... unlink` forgets the session; the number still has to be
   saved on the admin page (or as `WHATSAPP_NUMBER=2015XXXXXXXX` in `.env.prod`, which is now only the
   fallback when no number is saved there).
5. Kill switch: the **التحقق من الهاتف عبر واتساب** switch on the same page (or `auth.phoneVerification` in
   admin settings) hides phone verification
   without touching the bridge.

### 3.10 Create the first super admin (Task 1.10)

Nobody can grant the first `super_admin` from the admin panel, so it is done once from the server.

1. Register on the site with the email you will use as admin and click the verification link (the
   command refuses accounts that are not **active** with a **verified** email).
2. On the server:
   `dc --profile tools run --rm migrate node dist/cli/admin-grant.js you@example.com`
   The `migrate` service uses the api image (the compiled command is at `/app/dist/cli/admin-grant.js`)
   and the database owner role, and needs no other settings. It prints `granted` (or
   `already super_admin`) and exits 0; any problem prints one line and exits 1 without changing anything.
   The grant is written to the audit log as the system (`via: cli`).
3. Sign in on the site, then **turn on two-factor authentication**. `/admin` is
   refused until the account has 2FA and the session went through the 2FA code. The permission cache
   lasts up to 5 minutes, so the new role may take that long to show up.

On your own computer: `pnpm --filter @wasfa/api admin:grant:dev you@example.com` (reads `DATABASE_URL`
from `.env`), or after `pnpm build`, `pnpm --filter @wasfa/api admin:grant you@example.com`.

## 4. Everyday commands (on the server)

Log in: `ssh deploy@<ELASTIC-IP>`. First define a short name for the long command (add it to `~/.bashrc`):

```bash
alias dc='docker compose --env-file /opt/wasfa/.env.prod -f /opt/wasfa/compose.prod.yml'
```

| I want to… | Command |
|---|---|
| See what is running and healthy | `dc ps` |
| Read the logs of one service (live) | `dc logs -f --tail 100 api` (`web`, `worker`, `caddy`, `postgres`, `redis`) |
| Read errors only, all services | `dc logs --since 1h \| grep -i error` |
| Restart one service | `dc restart api` |
| Stop everything (data is kept) | `dc stop` |
| Start it again | `dc up -d` |
| Which version is live? | `cat /opt/wasfa/.deployed-sha` |
| How much memory/CPU is each container using? | `docker stats --no-stream` |
| Disk space (system, Docker) | `df -h /` and `docker system df` |
| Open a shell inside a container | `dc exec api sh` (`exit` to leave) |
| Open a database console | `dc exec postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` |
| Run database migrations by hand | `dc --profile tools run --rm migrate` |
| Free space from unused old images | `docker image prune -af --filter "until=168h"` |

**Updating** is automatic: merge to `main` → CI → images → Deploy workflow. Nothing is edited on the
server by hand, except `.env.prod`. After changing `.env.prod`, apply it with `dc up -d` (compose
recreates only the containers whose settings changed).

**Rolling back** to an older release: *Actions → Deploy → Run workflow* with the SHA of the old
commit (every merged commit has images). Or on the server, if GitHub is unreachable:
`printf '%s' "$TOKEN" | /opt/wasfa/deploy.sh <old-sha> <your-github-username>`.

> **Migrations are not undone by a rollback.** The old code then runs on the new database. That is
> safe only if each migration is written to be compatible with the previous release (add columns and
> tables first; remove old ones in a *later* release). Keep that rule.

**Changing the Cloudflare IP list.** Cloudflare rarely adds ranges. The server firewall refreshes
itself weekly; the list inside `infra/docker/Caddyfile` (`trusted_proxies`) is updated by hand: compare
with <https://www.cloudflare.com/ips-v4> and `/ips-v6` a few times a year.

---

## 5. Running it on your own computer (development)

You only need Docker Desktop for the database and Redis; the apps run directly with `pnpm dev`.

```bash
cp .env.example .env                     # then set ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose -f infra/docker/compose.dev.yml up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                                 # web :3000, api :4000, worker
```

Postgres and Redis are published to `127.0.0.1` only. If ports 5432/6379 are taken by a program
installed on your computer, start with `POSTGRES_PORT=55433 REDIS_PORT=56379 docker compose …` and put
the same ports in `DATABASE_URL` / `REDIS_URL` in `.env`.

To try the **production** stack on your computer (own certificates, no Cloudflare), see the
"Local production run" box in `docs/phases/phase0.md`, task 0.7.

---

## 6. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Deploy job red, "did not become ready" | Look at the log lines printed under it, or `dc logs --tail 100 api`. The previous version was restored automatically. Usually a missing/misspelled variable in `.env.prod`. |
| `dc ps` shows a service `Restarting` | `dc logs --tail 50 <service>`. API refusing to start prints the **names** of invalid variables (never their values). |
| `required variable X is missing` | `.env.prod` lacks X. Compare with `.env.example`. |
| Site shows Cloudflare error 522 | Cloudflare cannot reach the server at all: the AWS **security group** does not allow 80/443 from Cloudflare (section 3.1), or the instance IP changed (attach an **Elastic IP**). |
| Site shows Cloudflare error 520 | Origin answered badly: Authenticated Origin Pulls is the wrong mode, or Caddy cannot start (`dc logs caddy`). |
| Site shows Cloudflare error 521 / 525 / 526 | 521: containers down or firewall closed (`dc ps`). 525/526: certificate files wrong or SSL mode not *Full (strict)* (section 3.3). |
| Site shows 403 / handshake error from Cloudflare | *Authenticated Origin Pulls* is off in Cloudflare, or `cloudflare-origin-pull-ca.pem` is missing in `certs/`. |
| API says `RATE_LIMITED` for everybody | The real client address is not reaching the API: check the Cloudflare IP list in the Caddyfile and that the proxy is on (orange cloud). |
| `/health/ready` is 503 | Database or Redis is down: `dc ps`, `dc logs postgres`. The public body never says which; the API log does. |
| "No space left on device" | `docker system df`, then `docker image prune -af --filter "until=168h"`. Logs are already capped (10 MB × 5 per container). |
| Locked out of SSH | Your IP changed. Console → Security group → edit the SSH rule (or use Session Manager). |
| Backup alert on Telegram | `sudo journalctl -u wasfa-backup -n 100` and section 7. |

---

## 7. Backups and restore

### How it works

Every night at about 02:30 UTC a systemd timer on the server runs the `backup` container:

```
database ──pg_dump──▶ age (public key) ──▶ Cloudflare R2  wasfa-backups/daily/wasfa-<time>.dump.age
```

- The data is **encrypted while it streams**; the readable dump never touches a disk.
- Next to each dump, an encrypted list of **row counts for every table**, taken in the same instant,
  lets the restore test prove nothing is missing.
- Sundays the pair is also copied to `weekly/`. **Retention: 14 daily + 8 weekly**, older ones are deleted
  (the script refuses to delete anything unless more than that many exist).
- A partial upload (for example the database dies halfway) is deleted again and **never counts as a backup**.
- **A failure sends a Telegram message** (set `BACKUP_ALERT_TELEGRAM_BOT_TOKEN` and `_CHAT_ID`: talk to
  `@BotFather` for the token, send your bot a message, then read your chat id at
  `https://api.telegram.org/bot<token>/getUpdates`). To also notice a backup that *never starts*, create a free
  check at healthchecks.io and put its URL in `BACKUP_HEALTHCHECK_URL`: it is pinged after every success.
- Why a host timer and not a worker job: it must keep working (and alerting) when the worker or API is broken.

### Check that it works

```bash
systemctl list-timers wasfa-backup.timer              # next run time
dc --profile tools run --rm -T backup                 # run one now (takes seconds)
sudo journalctl -u wasfa-backup -n 50                 # what the timer did last night
```

In the R2 dashboard the bucket now shows `daily/wasfa-….dump.age`. Try downloading one and opening it:
it is unreadable without the private key (it starts with `age-encryption.org/v1`).

### Restore test (do it once now, then monthly)

This copies a backup into a **scratch database**, compares every table's row count with the backup's
list, and deletes the scratch database. It touches nothing else.

```bash
# 1. put the private key on the server just for this test (from your password manager)
install -m 600 /dev/null /tmp/age-key.txt && nano /tmp/age-key.txt        # paste, save
# 2. run the verification
dc --profile tools run --rm -T --user "$(id -u)" -v /tmp/age-key.txt:/run/age-identity:ro backup restore.sh --verify latest
# 3. ALWAYS remove the key again
shred -u /tmp/age-key.txt
```

Success looks like a table of `ok` lines ending with `verification passed: N tables restored with
identical row counts`. Any `MISMATCH` or error is a problem: fix it *now*, not on the day you need it.
`restore.sh --verify weekly/<file>` tests an older one.

### Disaster recovery (the server is gone)

1. New EC2 instance, then sections 3.1 → 3.3 (same Elastic IP if you still have it; otherwise update the Cloudflare A records).
2. Recreate `/opt/wasfa/.env.prod` with the **same** `ENCRYPTION_KEY` as before (from your safe place); new passwords are fine.
3. Start only the database: `dc up -d postgres redis`.
4. Restore the newest backup into the empty database:
   `dc --profile tools run --rm -T --user "$(id -u)" -v /tmp/age-key.txt:/run/age-identity:ro backup restore.sh --into <POSTGRES_DB> --overwrite-live latest`
   (`--overwrite-live` is required because that is the live database's name; it is empty on a new server.)
5. `shred -u /tmp/age-key.txt`, then `dc up -d` (or run the Deploy workflow). Check `/health/ready`.

The restore tool refuses to write into the live database unless you pass `--overwrite-live`, and it
only accepts real backup object names.

---

## 8. Security notes in one place

- Secrets live only in `/opt/wasfa/.env.prod` (600) and GitHub environment secrets. Never in git, never in chat.
- The server accepts web traffic only from Cloudflare (AWS security group + firewall + mutual TLS), SSH only from you.
- `deploy` can run Docker (which is root-equivalent) but has no `sudo` and cannot log in with a password; the CI key can do nothing else.
- Rotate on suspicion: Postgres/Redis passwords (edit `.env.prod`, `dc up -d`; Postgres also needs `ALTER USER`),
  the deploy key (replace in `authorized_keys` and the GitHub secret), the R2 token (R2 dashboard).
- Security updates install themselves. Docker and the images: Dependabot opens weekly pull requests; merging one rebuilds and redeploys.

## 9. Final verification checklist (Task 0.9)

- [ ] `curl -m 5 -k https://<ELASTIC-IP>/` fails (direct access refused).
- [ ] `ssh root@<ELASTIC-IP>` and password logins are refused.
- [ ] <https://www.ssllabs.com/ssltest/> for `wasfa.online`: grade **A+**.
- [ ] <https://securityheaders.com/> for `https://wasfa.online`: grade **A** or better.
- [ ] `dc ps`: everything `healthy`; `systemctl list-timers` shows the backup timer.
- [ ] One restore test passed (section 7).
