#!/usr/bin/env bash
set -Eeuo pipefail

release_name=${1:?usage: rollback.sh RELEASE_NAME}
app_root=/opt/incode-track
release_dir=${app_root}/releases/${release_name}
service=incode-track.service

if [[ ${EUID} -ne 0 ]]; then
  echo "rollback.sh must run as root" >&2
  exit 1
fi

# Release names are generated locally and may not contain path separators.
[[ ${release_name} =~ ^[0-9]{14}-[0-9A-Za-z._-]+$ ]] || { echo "Invalid release name" >&2; exit 2; }
[[ -d ${release_dir} ]] || { echo "Release does not exist: ${release_name}" >&2; exit 1; }

exec 9>/run/lock/incode-track-deploy.lock
flock -n 9 || { echo "Another deployment is already running" >&2; exit 1; }

previous_release=$(readlink -f "${app_root}/current" 2>/dev/null || true)
ln -sfn "${release_dir}" "${app_root}/current.new"
mv -Tf "${app_root}/current.new" "${app_root}/current"

if ! systemctl restart "${service}" || ! systemctl is-active --quiet "${service}"; then
  echo "Rollback target failed; restoring the prior release" >&2
  if [[ -n ${previous_release} && -d ${previous_release} ]]; then
    ln -sfn "${previous_release}" "${app_root}/current.new"
    mv -Tf "${app_root}/current.new" "${app_root}/current"
    systemctl restart "${service}" || true
  fi
  journalctl -u "${service}" -n 50 --no-pager >&2 || true
  exit 1
fi

echo "Rolled back to ${release_name}"
