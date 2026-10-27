#!/usr/bin/env bash
set -Eeuo pipefail

source_dir=${1:?uploaded source directory is required}
release_name=${2:?release name is required}
staged_only=${3:-false}
app_root=/opt/incode-track
release_dir=${app_root}/releases/${release_name}
service=incode-track.service
service_user=incode-track
lock_file=/run/lock/incode-track-deploy.lock

if [[ ${EUID} -ne 0 ]]; then
  echo "activate.sh must run as root" >&2
  exit 1
fi

exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Another deployment is already running" >&2
  exit 1
fi

[[ -d ${source_dir} ]] || { echo "Upload not found: ${source_dir}" >&2; exit 1; }
[[ ! -e ${release_dir} ]] || { echo "Release already exists: ${release_name}" >&2; exit 1; }
[[ -f /etc/incode-track/incode-track.env ]] || { echo "Run 'just bootstrap' and 'just env' first" >&2; exit 1; }
[[ ${staged_only} == false || ${staged_only} == true ]] || { echo "staged_only must be true or false" >&2; exit 2; }

mv "${source_dir}" "${release_dir}"
chown -R "${service_user}:${service_user}" "${release_dir}"
ln -s /etc/incode-track/incode-track.env "${release_dir}/.env"

run_as_app() {
  runuser -u "${service_user}" -- env \
    HOME=/var/lib/incode-track \
    NPM_CONFIG_CACHE=/var/lib/incode-track/.npm \
    "$@"
}

cd "${release_dir}"
run_as_app env NODE_ENV=development npm ci --include=dev --no-audit --no-fund
if [[ ${staged_only} == false ]]; then
  run_as_app npm run env:check
fi
run_as_app npm run build
run_as_app npm run setup
# SQLite may be created with a world-readable default mode by Prisma.
find /var/lib/incode-track -maxdepth 1 -type f -name '*.sqlite*' -exec chmod 0640 {} +
run_as_app npm prune --omit=dev --no-audit --no-fund

previous_release=$(readlink -f "${app_root}/current" 2>/dev/null || true)
ln -sfn "${release_dir}" "${app_root}/current.new"
mv -Tf "${app_root}/current.new" "${app_root}/current"

if [[ ${staged_only} == true ]]; then
  systemctl stop "${service}" || true
  echo "Activated ${release_name}; service remains stopped until production environment values are configured."
  exit 0
fi

if ! systemctl restart "${service}" || ! systemctl is-active --quiet "${service}"; then
  echo "New release failed to start; restoring the previous release" >&2
  if [[ -n ${previous_release} && -d ${previous_release} ]]; then
    ln -sfn "${previous_release}" "${app_root}/current.new"
    mv -Tf "${app_root}/current.new" "${app_root}/current"
    systemctl restart "${service}" || true
  fi
  journalctl -u "${service}" -n 50 --no-pager >&2 || true
  exit 1
fi

# Keep the five newest releases. Timestamp-prefixed names sort chronologically.
mapfile -t old_releases < <(find "${app_root}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +6)
for old_release in "${old_releases[@]}"; do
  old_path="${app_root}/releases/${old_release}"
  [[ $(readlink -f "${app_root}/current") == "${old_path}" ]] || rm -rf -- "${old_path}"
done

echo "Activated ${release_name}"
systemctl --no-pager --full status "${service}"
