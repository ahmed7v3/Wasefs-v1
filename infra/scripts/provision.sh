#!/usr/bin/env bash
# Provisions a fresh Ubuntu 24.04 LTS server (AWS EC2) for the Wasfa production stack.
# Idempotent: safe to run again after a failure or to pick up a changed setting.
#
#   sudo OWNER_IP_CIDR=203.0.113.7/32 \
#        DEPLOY_AUTHORIZED_KEYS_FILE=./deploy_keys.pub \
#        ./provision.sh [--dry-run]
#
# Required
#   OWNER_IP_CIDR                 your public IP as a /32 (SSH is opened to it only). Use
#                                 ALLOW_SSH_FROM_ANYWHERE=1 instead only if you accept SSH open
#                                 to the world (fail2ban still applies); AWS SSM is the better fix.
#   DEPLOY_AUTHORIZED_KEYS_FILE   file with the public key(s) allowed to log in as `deploy`
#                                 (the GitHub Actions deploy key's public half, plus yours).
# Optional
#   ADMIN_USER                    the account you are logged in with and that keeps sudo
#                                 (default: $SUDO_USER, else ubuntu). Its authorized_keys must work!
#   AUTO_REBOOT                   1 (default) = unattended-upgrades reboots at 03:30 UTC when a
#                                 kernel update needs it; 0 = never reboot automatically.
#   WASFA_DIR                     install directory (default /opt/wasfa)
#
# Read docs/DOCKER-GUIDE.md first: the AWS and Cloudflare parts are done in their consoles.
#
# What this does NOT do (it cannot, it runs on the server): Elastic IP, the AWS security group,
# the billing alarm, and everything in Cloudflare. They are step-by-step in the guide.
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

WASFA_DIR="${WASFA_DIR:-/opt/wasfa}"
AUTO_REBOOT="${AUTO_REBOOT:-1}"
ADMIN_USER="${ADMIN_USER:-${SUDO_USER:-ubuntu}}"
DEPLOY_USER="deploy"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Runs a command, or only prints it in --dry-run mode.
run() {
  if (( DRY_RUN )); then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}

# write_file <path> <mode>: content from stdin. Prints instead of writing in --dry-run mode.
write_file() {
  local path="$1" mode="$2"
  if (( DRY_RUN )); then
    printf '  [dry-run] write %s (mode %s):\n' "$path" "$mode"
    sed 's/^/      | /'
  else
    install -d -m 755 "$(dirname "$path")"
    cat > "$path"
    chmod "$mode" "$path"
  fi
}

# --- Preconditions ------------------------------------------------------------------------------
(( DRY_RUN )) || [[ "$(id -u)" -eq 0 ]] || die "run as root (sudo)"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || die "Ubuntu 24.04 LTS required (found ${PRETTY_NAME:-unknown})"
fi

if [[ -z "${OWNER_IP_CIDR:-}" && "${ALLOW_SSH_FROM_ANYWHERE:-0}" != "1" ]]; then
  die "set OWNER_IP_CIDR=<your.ip>/32 (or ALLOW_SSH_FROM_ANYWHERE=1)"
fi
if [[ -n "${OWNER_IP_CIDR:-}" && ! "$OWNER_IP_CIDR" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
  die "OWNER_IP_CIDR must look like 203.0.113.7/32"
fi
[[ -n "${DEPLOY_AUTHORIZED_KEYS_FILE:-}" && -s "${DEPLOY_AUTHORIZED_KEYS_FILE}" ]] \
  || die "DEPLOY_AUTHORIZED_KEYS_FILE must point to a file with at least one public key"
grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+|sk-ssh-ed25519@openssh.com) ' "$DEPLOY_AUTHORIZED_KEYS_FILE" \
  || die "no valid public key found in $DEPLOY_AUTHORIZED_KEYS_FILE"
(( DRY_RUN )) || id "$ADMIN_USER" >/dev/null 2>&1 || die "ADMIN_USER '$ADMIN_USER' does not exist"
(( DRY_RUN )) || [[ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]] \
  || die "/home/$ADMIN_USER/.ssh/authorized_keys is empty: disabling passwords would lock you out"

# --- 1. Base system -----------------------------------------------------------------------------
log "Base system: UTC, updates, packages"
run timedatectl set-timezone UTC
run apt-get update -y
run env DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
run env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg jq ufw fail2ban unattended-upgrades iptables apt-transport-https

# --- 2. Automatic security updates --------------------------------------------------------------
log "unattended-upgrades"
write_file /etc/apt/apt.conf.d/20auto-upgrades 644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
REBOOT_BOOL="false"; [[ "$AUTO_REBOOT" == "1" ]] && REBOOT_BOOL="true"
write_file /etc/apt/apt.conf.d/52wasfa-unattended-upgrades 644 <<EOF
// Security updates only (the Ubuntu default origins); Docker's repo is updated by hand.
Unattended-Upgrade::Automatic-Reboot "${REBOOT_BOOL}";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# --- 3. Users and SSH ---------------------------------------------------------------------------
log "deploy user and SSH hardening"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  run adduser --disabled-password --gecos "Wasfa deploy" "$DEPLOY_USER"
fi
# No sudo for `deploy`: the CI key only needs Docker. Administration uses $ADMIN_USER.
if (( ! DRY_RUN )); then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_AUTHORIZED_KEYS_FILE" "/home/$DEPLOY_USER/.ssh/authorized_keys"
else
  printf '  [dry-run] install %s -> /home/%s/.ssh/authorized_keys (0600)\n' "$DEPLOY_AUTHORIZED_KEYS_FILE" "$DEPLOY_USER"
fi

write_file /etc/ssh/sshd_config.d/10-wasfa-hardening.conf 644 <<EOF
# Managed by provision.sh. Files in this directory win over later ones (first value is kept).
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers ${ADMIN_USER} ${DEPLOY_USER}
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
if (( ! DRY_RUN )); then
  # Never reload a config that does not parse: that would lock everyone out.
  sshd -t || die "sshd config test failed; nothing was reloaded"
  systemctl reload ssh
else
  echo "  [dry-run] sshd -t && systemctl reload ssh"
fi

# --- 4. Firewall --------------------------------------------------------------------------------
log "Firewall: UFW + Docker (DOCKER-USER) restricted to Cloudflare"

# One script does the work so the weekly timer can re-run it when Cloudflare changes its ranges.
write_file /usr/local/sbin/wasfa-firewall 755 <<'EOF'
#!/usr/bin/env bash
# Applies the web firewall: ports 80/443 reachable from Cloudflare only.
#  * UFW rules cover services running on the host itself.
#  * Docker-published ports BYPASS UFW (Docker writes its own iptables rules), so the same ranges are
#    enforced in the DOCKER-USER chain, which Docker evaluates first and never rewrites.
# The AWS security group stays the primary perimeter; this is the second layer.
set -euo pipefail
fetch() { curl -fsS --max-time 20 "https://www.cloudflare.com/$1" | tr -d '\r'; }
V4="$(fetch ips-v4)"; V6="$(fetch ips-v6)"
[[ -n "$V4" && -n "$V6" ]] || { echo "empty Cloudflare range list; keeping current rules" >&2; exit 1; }
while read -r r; do [[ -z "$r" || "$r" =~ ^[0-9.]+/[0-9]+$ ]] || { echo "bad IPv4 range: $r" >&2; exit 1; }; done <<<"$V4"
while read -r r; do [[ -z "$r" || "$r" =~ ^[0-9a-fA-F:]+/[0-9]+$ ]] || { echo "bad IPv6 range: $r" >&2; exit 1; }; done <<<"$V6"

# --- UFW: replace our previous web rules (tagged 'cloudflare') with the current ranges.
for n in $(ufw status numbered | awk -F'[][]' '/cloudflare/ {print $2}' | sort -rn); do
  ufw --force delete "$n" >/dev/null
done
while read -r r; do [[ -n "$r" ]] && ufw allow proto tcp from "$r" to any port 80,443 comment cloudflare >/dev/null; done <<<"$V4"
while read -r r; do [[ -n "$r" ]] && ufw allow proto tcp from "$r" to any port 80,443 comment cloudflare >/dev/null; done <<<"$V6"

# --- DOCKER-USER: only Cloudflare may open new connections to published ports 80/443.
# Matched on the interface facing the internet, so containers' OUTBOUND https is untouched.
IFACE="$(ip -4 route show default | awk '{print $5; exit}')"
iptables -N WASFA-WEB 2>/dev/null || iptables -F WASFA-WEB
while read -r r; do [[ -n "$r" ]] && iptables -A WASFA-WEB -s "$r" -j RETURN; done <<<"$V4"
iptables -A WASFA-WEB -j DROP
iptables -N DOCKER-USER 2>/dev/null || true
if ! iptables -C DOCKER-USER -i "$IFACE" -p tcp -m multiport --dports 80,443 -j WASFA-WEB 2>/dev/null; then
  iptables -I DOCKER-USER 1 -i "$IFACE" -p tcp -m multiport --dports 80,443 -j WASFA-WEB
fi
echo "firewall: $(wc -l <<<"$V4") IPv4 + $(wc -l <<<"$V6") IPv6 Cloudflare ranges applied on $IFACE"
EOF

if (( ! DRY_RUN )); then
  ufw default deny incoming
  ufw default allow outgoing
  if [[ -n "${OWNER_IP_CIDR:-}" ]]; then
    ufw allow proto tcp from "$OWNER_IP_CIDR" to any port 22 comment ssh-owner
  else
    ufw limit 22/tcp comment ssh-anywhere
  fi
else
  echo "  [dry-run] ufw default deny incoming / allow outgoing; allow 22 from ${OWNER_IP_CIDR:-anywhere (rate limited)}"
fi
run /usr/local/sbin/wasfa-firewall
run ufw --force enable

# Re-apply after every boot (Docker recreates its chains at start) and weekly (ranges change).
write_file /etc/systemd/system/wasfa-firewall.service 644 <<'EOF'
[Unit]
Description=Wasfa firewall: web ports reachable from Cloudflare only
After=network-online.target docker.service ufw.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/wasfa-firewall

[Install]
WantedBy=multi-user.target
EOF
write_file /etc/systemd/system/wasfa-firewall.timer 644 <<'EOF'
[Unit]
Description=Refresh Cloudflare ranges weekly

[Timer]
OnBootSec=2min
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF
run systemctl daemon-reload
run systemctl enable --now wasfa-firewall.timer
run systemctl enable wasfa-firewall.service

# --- 5. fail2ban --------------------------------------------------------------------------------
log "fail2ban for SSH"
write_file /etc/fail2ban/jail.d/wasfa.local 644 <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
backend = systemd
EOF
run systemctl enable --now fail2ban
run systemctl restart fail2ban

# --- 6. Swap ------------------------------------------------------------------------------------
log "Swap file"
MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
# <=2 GB RAM: 2x RAM; up to 8 GB: 1x RAM; above: 4 GB. Capped at 4 GB, a safety net, not capacity.
if   (( MEM_MB <= 2048 )); then SWAP_MB=$(( MEM_MB * 2 ))
elif (( MEM_MB <= 8192 )); then SWAP_MB=$MEM_MB
else SWAP_MB=4096; fi
(( SWAP_MB > 4096 )) && SWAP_MB=4096
if (( ! DRY_RUN )) && ! swapon --show=NAME --noheadings | grep -q '^/swapfile'; then
  fallocate -l "${SWAP_MB}M" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "  RAM ${MEM_MB} MB -> swap ${SWAP_MB} MB (skipped: dry run or /swapfile already active)"
fi
write_file /etc/sysctl.d/99-wasfa.conf 644 <<'EOF'
# Prefer RAM; swap only under real pressure.
vm.swappiness = 10
# Redis background saves need to fork on small hosts.
vm.overcommit_memory = 1
EOF
run sysctl --system

# --- 7. Docker Engine + Compose plugin ----------------------------------------------------------
log "Docker Engine and Compose plugin (Docker's official apt repository)"
run install -m 0755 -d /etc/apt/keyrings
if (( ! DRY_RUN )); then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME:-noble} stable" \
    > /etc/apt/sources.list.d/docker.list
else
  echo "  [dry-run] add Docker apt repository"
fi
run apt-get update -y
run env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
write_file /etc/docker/daemon.json 644 <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
run systemctl enable --now docker
run systemctl restart docker
# `docker` group membership is root-equivalent; that is why `deploy` gets no sudo on top of it.
run usermod -aG docker "$DEPLOY_USER"

# --- 8. Directory layout ------------------------------------------------------------------------
log "Directory layout under ${WASFA_DIR}"
run install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WASFA_DIR"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WASFA_DIR/certs"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$WASFA_DIR/backups"
if (( ! DRY_RUN )) && [[ ! -e "$WASFA_DIR/.env.prod" ]]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "$WASFA_DIR/.env.prod"
fi

# --- 9. Nightly backup timer --------------------------------------------------------------------
# Host timer, not a worker job: a backup must still run (and alert) when the worker or API is down.
log "Nightly backup timer (02:30 UTC)"
write_file /etc/systemd/system/wasfa-backup.service 644 <<EOF
[Unit]
Description=Wasfa nightly encrypted database backup to R2
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=${DEPLOY_USER}
WorkingDirectory=${WASFA_DIR}
# Same image tag as the running release (deploy.sh records it); falls back to latest.
ExecStart=/bin/bash -c 'IMAGE_TAG="\$(cat .deployed-sha 2>/dev/null || echo latest)" exec docker compose --env-file .env.prod -f compose.prod.yml run --rm -T backup'
TimeoutStartSec=1h
SyslogIdentifier=wasfa-backup
EOF
write_file /etc/systemd/system/wasfa-backup.timer 644 <<'EOF'
[Unit]
Description=Run the Wasfa database backup every night

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
RandomizedDelaySec=10min
# If the server was off at 02:30, run as soon as it is back.
Persistent=true

[Install]
WantedBy=timers.target
EOF
run systemctl daemon-reload
run systemctl enable --now wasfa-backup.timer

log "Done"
cat <<EOF

Next steps (details in docs/DOCKER-GUIDE.md):
  1. From ANOTHER terminal, confirm you can still log in:   ssh ${ADMIN_USER}@<server-ip>
     and that root and passwords are refused:                ssh root@<server-ip>
  2. Put the Cloudflare Origin Certificate in ${WASFA_DIR}/certs/:
       origin.pem  origin.key  cloudflare-origin-pull-ca.pem      (chmod 600 on the key)
  3. Fill ${WASFA_DIR}/.env.prod from .env.example (chmod 600, owner ${DEPLOY_USER}).
  4. Add the GitHub 'production' environment secrets, then run the Deploy workflow.
EOF
