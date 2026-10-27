#!/usr/bin/env bash
set -Eeuo pipefail

unit_source=${1:?systemd unit source path is required}
env_example=${2:?production environment example path is required}

if [[ ${EUID} -ne 0 ]]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

# Amazon Linux 2023 ships curl and supports NodeSource's RPM repository. Node 22
# satisfies the application's >=22.12 runtime requirement.
# Amazon Linux provides curl-minimal by default; requesting the full curl package
# conflicts with it on some Lightsail images.
dnf install -y ca-certificates rsync
command -v curl >/dev/null 2>&1 || dnf install -y curl-minimal

node_is_supported=false
if command -v node >/dev/null 2>&1; then
  IFS=. read -r major minor _ <<<"$(node --version | sed 's/^v//')"
  if (( major == 20 && minor >= 19 )) || (( major == 22 && minor >= 12 )) || (( major > 22 )); then
    node_is_supported=true
  fi
fi

if [[ ${node_is_supported} != true ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi

if ! id incode-track >/dev/null 2>&1; then
  useradd --system --home-dir /opt/incode-track --shell /sbin/nologin incode-track
fi

install -d -m 0755 -o root -g root /opt/incode-track /opt/incode-track/releases
install -d -m 0750 -o incode-track -g incode-track /var/lib/incode-track
install -d -m 0750 -o root -g incode-track /etc/incode-track

if [[ ! -e /etc/incode-track/incode-track.env ]]; then
  install -m 0640 -o root -g incode-track "${env_example}" /etc/incode-track/incode-track.env
fi

install -m 0644 -o root -g root "${unit_source}" /etc/systemd/system/incode-track.service
systemctl daemon-reload
systemctl enable incode-track.service

rm -f /tmp/bootstrap.sh /tmp/incode-track.service /tmp/production.env.example

echo
echo "Bootstrap complete: $(node --version), npm $(npm --version)"
echo "Next: run 'just env', set DATABASE_URL=file:/var/lib/incode-track/incode-track.sqlite and the other production values, then run 'just deploy'."
