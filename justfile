# Production deployment for Amazon Linux 2023.
# Copy .deploy.env.example to .deploy.env and set DEPLOY_HOST first.
set dotenv-load := true
set dotenv-filename := ".deploy.env"
set shell := ["bash", "-euo", "pipefail", "-c"]

host := env_var_or_default("DEPLOY_HOST", "")
user := env_var_or_default("DEPLOY_USER", "ec2-user")
port := env_var_or_default("DEPLOY_PORT", "22")
identity := env_var_or_default("DEPLOY_IDENTITY_FILE", "")
target := user + "@" + host
ssh_options := if identity == "" { "-p " + port } else { "-p " + port + " -i " + identity }
scp_options := if identity == "" { "-P " + port } else { "-P " + port + " -i " + identity }
rsync_ssh := if identity == "" { "ssh -p " + port } else { "ssh -p " + port + " -i " + identity }

_default:
  @just --list

# Validate local code before releasing it.
verify:
  npm ci
  npm test
  npm run typecheck
  npm run lint
  npm run build

# One-time server setup: Node.js 22, service account, directories and systemd unit.
bootstrap: check-deploy-config
  scp {{scp_options}} deploy/bootstrap.sh deploy/incode-track.service deploy/production.env.example {{target}}:/tmp/
  ssh {{ssh_options}} {{target}} 'sudo bash /tmp/bootstrap.sh /tmp/incode-track.service /tmp/production.env.example'

# Upload, build, migrate, atomically activate and restart the application.
deploy: check-deploy-config verify
  # A unique release permits atomic activation and straightforward rollback.
  release="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"; \
  remote_tmp="/tmp/incode-track-${release}"; \
  rsync -az --delete -e '{{rsync_ssh}}' \
    --exclude='.git/' --exclude='.env' --exclude='.env.*' \
    --exclude='.deploy.env' --exclude='node_modules/' --exclude='build/' \
    --exclude='.cache/' --exclude='.react-router/' --exclude='.shopify/' \
    ./ "{{target}}:${remote_tmp}/"; \
  ssh {{ssh_options}} {{target}} "sudo bash '${remote_tmp}/deploy/activate.sh' '${remote_tmp}' '${release}'"

# Deploy without repeating local checks (use only when verify has already passed).
deploy-fast: check-deploy-config
  release="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"; \
  remote_tmp="/tmp/incode-track-${release}"; \
  rsync -az --delete -e '{{rsync_ssh}}' \
    --exclude='.git/' --exclude='.env' --exclude='.env.*' \
    --exclude='.deploy.env' --exclude='node_modules/' --exclude='build/' \
    --exclude='.cache/' --exclude='.react-router/' --exclude='.shopify/' \
    ./ "{{target}}:${remote_tmp}/"; \
  ssh {{ssh_options}} {{target}} "sudo bash '${remote_tmp}/deploy/activate.sh' '${remote_tmp}' '${release}'"

# Build and activate a release while leaving the service stopped for later configuration.
deploy-unconfigured: check-deploy-config
  release="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"; \
  remote_tmp="/tmp/incode-track-${release}"; \
  rsync -az --delete -e '{{rsync_ssh}}' \
    --exclude='.git/' --exclude='.env' --exclude='.env.*' \
    --exclude='.deploy.env' --exclude='node_modules/' --exclude='build/' \
    --exclude='.cache/' --exclude='.react-router/' --exclude='.shopify/' \
    ./ "{{target}}:${remote_tmp}/"; \
  ssh {{ssh_options}} {{target}} "sudo bash '${remote_tmp}/deploy/activate.sh' '${remote_tmp}' '${release}' true"

# Install or edit production secrets on the server.
env: check-deploy-config
  ssh -t {{ssh_options}} {{target}} 'sudo install -d -m 0750 -o root -g incode-track /etc/incode-track; sudo touch /etc/incode-track/incode-track.env; sudo chown root:incode-track /etc/incode-track/incode-track.env; sudo chmod 0640 /etc/incode-track/incode-track.env; sudo ${EDITOR:-vi} /etc/incode-track/incode-track.env'

# Restart the deployed application.
restart: check-deploy-config
  ssh {{ssh_options}} {{target}} 'sudo systemctl restart incode-track'

# Follow application logs. Ctrl-C exits without stopping the service.
logs: check-deploy-config
  ssh -t {{ssh_options}} {{target}} 'sudo journalctl -u incode-track -n 100 -f'

status: check-deploy-config
  ssh -t {{ssh_options}} {{target}} 'sudo systemctl status incode-track --no-pager'

# Show releases retained on the server.
releases: check-deploy-config
  ssh {{ssh_options}} {{target}} 'sudo find /opt/incode-track/releases -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort -r'

# Activate a retained release: just rollback RELEASE_NAME
rollback release: check-deploy-config
  ssh {{ssh_options}} {{target}} "sudo bash /opt/incode-track/current/deploy/rollback.sh '{{release}}'"

check-deploy-config:
  @test -n '{{host}}' || { echo 'DEPLOY_HOST is required. Copy .deploy.env.example to .deploy.env.' >&2; exit 2; }
