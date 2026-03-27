#!/usr/bin/env bash
# Check that Spindle release-facing manifest versions stay synchronised.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
	cat <<'EOF'
Usage:
  scripts/check-release-versions.sh
  scripts/check-release-versions.sh --current-version
  scripts/check-release-versions.sh --quiet

Options:
  --current-version   Print the current synchronised release version and exit
  --quiet             Suppress the success summary
  -h, --help          Show this help
EOF
}

fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

read_json_version() {
	local file_path="$1"

	node -e "const fs=require('fs'); const path=process.argv[1]; const data=JSON.parse(fs.readFileSync(path,'utf8')); const version=data.version ?? ''; if (!version) process.exit(1); process.stdout.write(String(version));" "$file_path" \
		|| fail "Could not read a version from ${file_path#${REPO_ROOT}/}"
}

read_toml_version() {
	local file_path="$1"
	local version

	version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$file_path" | head -n 1)"
	[[ -n "$version" ]] || fail "Could not read a version from ${file_path#${REPO_ROOT}/}"

	printf '%s' "$version"
}

MODE="report"
QUIET=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--current-version)
			MODE="current-version"
			shift
			;;
		--quiet)
			QUIET=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			fail "Unknown option: $1"
			;;
	esac
done

FILE_SPECS=(
	"Workspace package.json|package.json|json"
	"Desktop package.json|apps/spindle/package.json|json"
	"Tauri config|apps/spindle/src-tauri/tauri.conf.json|json"
	"Desktop Cargo manifest|apps/spindle/src-tauri/Cargo.toml|toml"
	"Plugin Cargo manifest|plugins/tauri-plugin-spindle-project/Cargo.toml|toml"
)

declare -a VERSION_ROWS=()
REFERENCE_VERSION=""
HAS_MISMATCH=false

for spec in "${FILE_SPECS[@]}"; do
	IFS='|' read -r label relative_path file_type <<< "$spec"
	absolute_path="${REPO_ROOT}/${relative_path}"

	[[ -f "$absolute_path" ]] || fail "Expected file not found: $relative_path"

	case "$file_type" in
		json)
			version="$(read_json_version "$absolute_path")"
			;;
		toml)
			version="$(read_toml_version "$absolute_path")"
			;;
		*)
			fail "Unsupported file type: $file_type"
			;;
	esac

	VERSION_ROWS+=("${label}|${relative_path}|${version}")

	if [[ -z "$REFERENCE_VERSION" ]]; then
		REFERENCE_VERSION="$version"
	elif [[ "$version" != "$REFERENCE_VERSION" ]]; then
		HAS_MISMATCH=true
	fi
done

if [[ "$HAS_MISMATCH" == true ]]; then
	printf 'Release version mismatch detected:\n' >&2
	for row in "${VERSION_ROWS[@]}"; do
		IFS='|' read -r label relative_path version <<< "$row"
		printf '  - %-24s %s (%s)\n' "$label:" "$version" "$relative_path" >&2
	done
	exit 1
fi

if [[ "$MODE" == "current-version" ]]; then
	printf '%s\n' "$REFERENCE_VERSION"
	exit 0
fi

if [[ "$QUIET" == false ]]; then
	printf 'Release versions are synchronised at %s:\n' "$REFERENCE_VERSION"
	for row in "${VERSION_ROWS[@]}"; do
		IFS='|' read -r _label relative_path _version <<< "$row"
		printf '  - %s\n' "$relative_path"
	done
fi
