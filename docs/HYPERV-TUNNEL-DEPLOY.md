# HYPERV-TUNNEL-DEPLOY.md — production on a Hyper-V Ubuntu VM behind a Cloudflare Tunnel

> Use this when the production host is a VM on your own Windows PC and the router cannot forward ports.
> `cloudflared` on the VM opens an **outbound** connection to Cloudflare; visitors and GitHub Actions reach
> the VM through it. Nothing is exposed on your home IP. Companion docs: `docs/DOCKER-GUIDE.md` (the AWS
> flavour of the same stack), `infra/scripts/provision.sh`, `infra/scripts/deploy.sh`.
> Commands marked **[Windows]** run in PowerShell on the host PC, **[VM]** in the Ubuntu VM over SSH,
> **[Cloudflare]** / **[GitHub]** in the dashboards (or `gh` where shown).

```
visitor ──► Cloudflare edge ──► tunnel (outbound from the VM) ──► cloudflared ──► Caddy 127.0.0.1:443 ──► web / api
GitHub Actions ──► Cloudflare Access (service token) ──► tunnel ──► sshd 127.0.0.1:22 (user "deploy")
```

## 0. Know the trade-offs (a PC is not a data centre)

- The site is up only while your PC, the VM, your power and your ISP are up. Use a UPS if you can.
- Windows Update reboots the host: step 1 makes the VM start by itself afterwards.
- Hyper-V "Default Switch" hands out a **new VM IP after each host reboot** (your 172.29.90.x address).
  The public site does not care (the tunnel is outbound), but your own SSH target changes. Prefer an
  External switch (bridged to your LAN, DHCP reservation in the router) or find the IP with
  `Get-VM <name> | Get-VMNetworkAdapter | Select IPAddresses`.
- Backups go to R2 every night (step 9). Keep the age **private** key offline: without it a backup is useless.
- Sizing: the stack is limited to ~3.2 GB. Give the VM 4 vCPU and 6–8 GB of static RAM, 60 GB+ disk.

## 1. Hyper-V settings [Windows, admin PowerShell]

```powershell
$vm = "<your VM name>"
Set-VM -Name $vm -AutomaticStartAction Start -AutomaticStartDelay 30 -AutomaticStopAction ShutDown
Set-VM -Name $vm -CheckpointType Disabled          # checkpoints of a database VM bite you on restore
Set-VMProcessor -VMName $vm -Count 4
Set-VMMemory -VMName $vm -DynamicMemoryEnabled $false -StartupBytes 6GB   # VM must be off to change
powercfg /change standby-timeout-ac 0              # the PC must never sleep
powercfg /change hibernate-timeout-ac 0
```

## 2. SSH key login (once) [Windows]

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\wasfa-hyperv -C "wasfa-hyperv-admin"
type $env:USERPROFILE\.ssh\wasfa-hyperv.pub | ssh ahmed@172.29.90.29 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
ssh -i $env:USERPROFILE\.ssh\wasfa-hyperv ahmed@172.29.90.29 "echo key login works"
```

Use the keyboard layout carefully when typing the VM password: on an Arabic layout the same keys type
different characters.

## 3. Get the repo scripts onto the VM [VM]

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/ahmed7v3/wasfa.online.git ~/wasfa && cd ~/wasfa   # use your real repo URL
```

The CI deploy key's public half is needed in step 4: on the PC it is `~/.ssh/wasfa-new/wasfa-deploy.pub`
(the same key the GitHub `production` environment already holds). Copy it to the VM as `~/deploy_keys.pub`
(`scp`), and append your own public key to the same file if you want to log in as `deploy` too.

## 4. Provision the VM (Docker, deploy user, SSH hardening, firewall, swap, backup timer, cloudflared) [VM]

First create the tunnel (step 5) to get a token, then run once. `OWNER_IP_CIDR` is your LAN, not a public IP.

```bash
cd ~/wasfa
sudo TUNNEL_MODE=1 OWNER_IP_CIDR=172.29.90.0/24 ADMIN_USER=ahmed \
     DEPLOY_AUTHORIZED_KEYS_FILE=$HOME/deploy_keys.pub \
     TUNNEL_TOKEN='<token from step 5>' \
     ./infra/scripts/provision.sh --dry-run        # read the plan first
# then the same line without --dry-run
```

What it does in tunnel mode: updates, unattended security upgrades, user `deploy` (Docker, no sudo),
SSH hardening (no root, no passwords: **make sure your key login from step 2 works first**), UFW with
SSH from the LAN only and **no** web ports, fail2ban, swap, Docker Engine, `/opt/wasfa`, the nightly backup
timer and `cloudflared`. It keeps your Egyptian timezone.

Check from a second terminal before closing the first: `ssh -i ~/.ssh/wasfa-hyperv ahmed@<ip>` works and
`ssh ahmed@<ip>` with a password is refused.

## 5. Cloudflare Tunnel and Access [Cloudflare]

1. Zero Trust → **Networks → Tunnels → Create a tunnel** → *Cloudflared* → name `wasfa-hyperv`.
   Copy the **token** from the install command (the long string after `service install`). Treat it as a password.
2. On the VM: `sudo cloudflared service install <token>` (skip if provision.sh did it) and check
   `systemctl status cloudflared` shows *active (running)* and the dashboard shows the tunnel **Healthy**.
3. **Published application routes** (public hostnames) — one per name. For the four web names the service is
   `HTTPS` → `127.0.0.1:443`, and under *Additional settings → TLS*: **No TLS Verify = on** and
   **Origin Server Name = the same hostname** (Caddy picks its site block from it):

   | Hostname | Service | Origin Server Name |
   |---|---|---|
   | `wasfa.online` | `https://127.0.0.1:443` | `wasfa.online` |
   | `www.wasfa.online` | `https://127.0.0.1:443` | `www.wasfa.online` |
   | `api.wasfa.online` | `https://127.0.0.1:443` | `api.wasfa.online` |
   | `early.wasfa.online` | `https://127.0.0.1:443` | `early.wasfa.online` |
   | `ssh.wasfa.online` | `ssh://127.0.0.1:22` | — |

   Saving a hostname creates its proxied CNAME to `<tunnel-id>.cfargotunnel.com`. If an old `A` record with
   that name exists the dashboard refuses: that is the cutover (step 10), do it when the stack is healthy.
   Do `ssh.wasfa.online` first, it has no old record.
4. **Access for SSH.** Zero Trust → **Access → Service credentials → Service Tokens → Create** (`github-deploy`,
   no expiry or one you will remember to renew). Copy the *Client ID* and *Client Secret* (shown once).
   Then **Access → Applications → Add → Self-hosted**: name `ssh deploy`, domain `ssh.wasfa.online`,
   policy *Service Auth* → include the token `github-deploy`. Add a second *Allow* policy for your own e-mail
   if you also want to SSH from outside your LAN with `cloudflared access ssh`.

## 6. `.env.prod` on the VM [VM]

```bash
sudo -u deploy bash -c 'cd /opt/wasfa && umask 077 && cp ~/wasfa/.env.example .env.prod 2>/dev/null || true'
sudoedit -u deploy /opt/wasfa/.env.prod      # or copy your old .env.prod (never print it)
```

Required keys (compose refuses to start without them): `POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
API_DB_PASSWORD REDIS_PASSWORD ENCRYPTION_KEY BETTER_AUTH_SECRET TURNSTILE_SECRET_KEY SMTP_USER SMTP_PASS
GHCR_OWNER`. Generate fresh ones on the VM (values never enter a chat):

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD, API_DB_PASSWORD (hex only: used inside URLs)
openssl rand -base64 48   # BETTER_AUTH_SECRET, REDIS_PASSWORD (no spaces), REVALIDATE_SECRET, CONTENT_PREVIEW_SECRET
```

**If you restore a backup (step 8) keep the OLD `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`**: settings stored
encrypted in the database (AI keys, WhatsApp session) are unreadable with a new key, and sessions break.

Add the tunnel-mode lines:

```
CADDY_TLS_FILE=./caddy/tls.local.caddy
HTTP_BIND=127.0.0.1:
HTTPS_BIND=127.0.0.1:
```

With the tunnel you do **not** need `certs/origin.pem` / Authenticated Origin Pulls: Caddy uses its own
certificate on the loopback and cloudflared skips verifying it.

## 7. GitHub: secrets and variables for the deploy workflow [GitHub / gh]

Merge the pull request that contains this document first (it adds tunnel support to `compose.prod.yml`,
the `Caddyfile` and `deploy.yml`), so CI builds images of that commit.

On the VM print the host key (SSH cannot be `ssh-keyscan`ned through the tunnel):

```bash
echo "ssh.wasfa.online $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

On the PC:

```powershell
gh variable set DEPLOY_VIA_TUNNEL --env production --body true
gh secret set DEPLOY_HOST          --env production --body ssh.wasfa.online
gh secret set DEPLOY_USER          --env production --body deploy
gh secret set DEPLOY_KNOWN_HOSTS   --env production --body "<the line printed above>"
gh secret set DEPLOY_SSH_KEY       --env production < $env:USERPROFILE\.ssh\wasfa-new\wasfa-deploy
gh secret set CF_ACCESS_CLIENT_ID     --env production --body "<service token client id>"
gh secret set CF_ACCESS_CLIENT_SECRET --env production --body "<service token client secret>"
```

## 8. Restore the database (optional, if the old production data matters) [VM]

Backups are `age`-encrypted dumps in your R2 bucket. You need the **private** key (`age-key.txt`, kept
offline) and the `R2_*` / `BACKUP_AGE_PUBLIC_KEY` values in `.env.prod`. Read the header of
`infra/scripts/restore.sh` first. Always verify before restoring:

```bash
cd /opt/wasfa
dc() { docker compose --env-file .env.prod -f compose.prod.yml "$@"; }
dc up -d postgres redis
dc --profile tools run --rm -v /path/to/age-key.txt:/run/age-identity:ro backup restore.sh --verify latest
dc --profile tools run --rm -v /path/to/age-key.txt:/run/age-identity:ro backup restore.sh --into "$POSTGRES_DB" --overwrite-live latest
shred -u /path/to/age-key.txt   # remove the key from the VM when done
```

The WhatsApp session lives in this database: **never run two stacks on the same data** (the old AWS server
must stay off), or the two bridges fight over the session.

## 9. First deployment [GitHub]

Pick the commit to deploy (a `main` commit whose CI passed, so its images are in GHCR) and run:

```powershell
gh run list --workflow CI --branch main --limit 5            # find a green commit
gh workflow run Deploy -f sha=<40-character sha>
gh run watch
```

The workflow installs a pinned `cloudflared` on the runner, opens SSH through Access, copies the compose
files, and runs `deploy.sh` (pull → migrate → up → wait for `/health/ready` → automatic rollback). After this,
every push to `main` that passes CI deploys the same way.

On the VM: `docker ps` should show caddy, web, api, worker, wa-bridge, postgres, redis healthy.

## 10. Switch the domain [Cloudflare]

Only when step 9 succeeded. On the VM: `curl -sk --resolve wasfa.online:443:127.0.0.1 https://wasfa.online/healthz`.

1. DNS → delete the old `A` records for `wasfa.online`, `www`, `api`, `early` (they point at the dead AWS IP).
   Keep `assets` / `media` (R2) and the Brevo DKIM records untouched.
2. Tunnel → *Published application routes* → add the four web hostnames from the table in step 5
   (this creates the CNAMEs).
3. From any network: `curl -I https://wasfa.online`, `https://api.wasfa.online/health/ready`,
   `https://wasfa.online/robots.txt`, `https://wasfa.online/sitemap.xml`.

SSL/TLS mode and Authenticated Origin Pulls in the zone settings no longer matter for tunnelled hostnames.
The `Live HTML check` workflow then validates the real site.

## 11. Verify

```bash
systemctl is-active cloudflared docker fail2ban ufw wasfa-backup.timer
sudo ufw status verbose            # 22 from the LAN only, nothing on 80/443
sudo ss -tlnp | grep -E ':(80|443)\b'   # bound to 127.0.0.1 only
docker ps --format '{{.Names}}\t{{.Status}}'
cat /opt/wasfa/.deployed-sha
```

Client IP check: sign in from your phone, then in the API logs the request IP must be your public IP, not
`172.30.0.1` (Caddy trusts the Docker gateway in tunnel mode and reads `CF-Connecting-IP`). If it shows the
gateway, rate limiting treats all visitors as one person: stop and fix before launch.

## 12. Operations

- Logs: `docker compose --env-file .env.prod -f compose.prod.yml logs -f --tail 100 api` · tunnel: `journalctl -u cloudflared -f`.
- Roll back: `gh workflow run Deploy -f sha=<older 40-character sha>` (migrations are not rolled back).
- Update `cloudflared`: bump the version and checksum in `provision.sh` and `deploy.yml`, then on the VM
  `sudo cloudflared update` or reinstall the `.deb`; `sudo systemctl restart cloudflared`.
- Host reboot: the VM auto-starts (step 1), Docker restarts the containers, `cloudflared` is a systemd service.
  Test it once: `sudo reboot` and watch the site return.
- Test a backup restore monthly (step 8, `--verify`).

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| 502 / 1033 on the site | `systemctl status cloudflared`; the route's service must be `https://127.0.0.1:443` with No TLS Verify and the Origin Server Name set |
| 522 / timeout | the tunnel is down (VM off, no internet) — a tunnel never gives 522 while connected |
| Caddy answers 421 / wrong site | Origin Server Name missing or not equal to the hostname |
| Deploy: `kex_exchange_identification` / `websocket: bad handshake` | the Access application's service-token policy, or the token pair in the secrets |
| Deploy: host key mismatch | `DEPLOY_KNOWN_HOSTS` must use the name `ssh.wasfa.online` and the VM's ed25519 key |
| Everyone rate-limited as one IP | gateway not in `trusted_proxies`, or `HTTPS_BIND` not applied: `docker inspect` the caddy ports |
| Locked out of SSH | use the Hyper-V console (*Connect*), fix `/etc/ssh/sshd_config.d/`, `sudo systemctl restart ssh` |
