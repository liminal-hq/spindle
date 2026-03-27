#!/usr/bin/env bash
# Prepare Spindle release-facing version updates across manifests.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_SCRIPT="${REPO_ROOT}/scripts/check-release-versions.sh"

usage() {
	cat <<'EOF'
Usage:
  scripts/prepare-release-version.sh --current-version
  scripts/prepare-release-version.sh --version <version> [--branch <name>] [--dry-run] [--no-branch]

Options:
  --current-version     Print the current synchronised release version and exit
  --version <version>   New release version, with or without a leading `v`
  --branch <name>       Override the default branch name (`chore/release-vX.Y.Z`)
  --no-branch           Update files on the current branch instead of creating a release branch
  --dry-run             Show the planned changes without writing files
  -h, --help            Show this help

Examples:
  scripts/prepare-release-version.sh --current-version
  scripts/prepare-release-version.sh --version 0.1.0
  scripts/prepare-release-version.sh --version v0.1.0-beta.1 --dry-run
  scripts/prepare-release-version.sh --version 0.1.0 --branch chore/release-v0.1.0-hotfix
EOF
}

fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

info() {
	printf '%s\n' "$*"
}

require_clean_repo() {
	if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain)" ]]; then
		fail "Working tree is dirty. Commit or stash changes before preparing a release."
	fi
}

normalise_version() {
	local input="$1"

	input="${input#v}"
	if [[ ! "$input" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
		fail "Version must look like 0.1.0, v0.1.0, or 0.1.0-beta.1"
	fi

	printf '%s' "$input"
}

write_json_version() {
	local file_path="$1"
	local version="$2"

	node -e "const fs=require('fs'); const path=process.argv[1]; const version=process.argv[2]; const data=JSON.parse(fs.readFileSync(path,'utf8')); data.version=version; fs.writeFileSync(path, JSON.stringify(data, null, '\t') + '\n');" "$file_path" "$version"
}

write_toml_version() {
	local file_path="$1"
	local current_version="$2"
	local new_version="$3"

	perl -0pi -e 's/^version = "\Q'"${current_version}"'\E"$/version = "'"${new_version}"'"/m' "$file_path"
}

refresh_cargo_lock() {
	local lockfile_path="${REPO_ROOT}/Cargo.lock"

	[[ -f "$lockfile_path" ]] || return 0

	info
	info "Refreshing Cargo.lock for workspace version updates"
	cargo update --workspace --manifest-path "${REPO_ROOT}/Cargo.toml" >/dev/null
}

CURRENT_VERSION_ONLY=false
VERSION_INPUT=""
BRANCH_INPUT=""
CREATE_BRANCH=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--current-version)
			CURRENT_VERSION_ONLY=true
			shift
			;;
		--version)
			[[ $# -ge 2 && -n "${2:-}" ]] || fail "Missing value for --version"
			VERSION_INPUT="$2"
			shift 2
			;;
		--branch)
			[[ $# -ge 2 && -n "${2:-}" ]] || fail "Missing value for --branch"
			BRANCH_INPUT="$2"
			shift 2
			;;
		--no-branch)
			CREATE_BRANCH=false
			shift
			;;
		--dry-run)
			DRY_RUN=true
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

if [[ "$CURRENT_VERSION_ONLY" == true ]]; then
	[[ -z "$VERSION_INPUT" && -z "$BRANCH_INPUT" && "$CREATE_BRANCH" == true && "$DRY_RUN" == false ]] || fail "--current-version cannot be combined with other options"
	"${CHECK_SCRIPT}" --current-version
	exit 0
fi

[[ -n "$VERSION_INPUT" ]] || fail "Missing required option: --version"
[[ -x "$CHECK_SCRIPT" ]] || fail "Expected helper script not found or not executable: scripts/check-release-versions.sh"

require_clean_repo

CURRENT_VERSION="$("${CHECK_SCRIPT}" --current-version)"
NEW_VERSION="$(normalise_version "$VERSION_INPUT")"
TARGET_BRANCH="${BRANCH_INPUT:-chore/release-v${NEW_VERSION}}"

if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
	fail "Release version is already ${NEW_VERSION}"
fi

FILES=(
	"package.json"
	"apps/spindle/package.json"
	"apps/spindle/src-tauri/tauri.conf.json"
	"apps/spindle/src-tauri/Cargo.toml"
	"plugins/tauri-plugin-spindle-project/Cargo.toml"
)

info "Preparing Spindle release version update"
info "  Current version: ${CURRENT_VERSION}"
info "  New version:     ${NEW_VERSION}"
if [[ "$CREATE_BRANCH" == true ]]; then
	info "  Release branch:  ${TARGET_BRANCH}"
else
	info "  Release branch:  staying on $(git -C "${REPO_ROOT}" branch --show-current)"
fi

if [[ "$DRY_RUN" == true ]]; then
	info
	info "Dry run only. These files would be updated:"
	for file in "${FILES[@]}"; do
		info "  - ${file}"
	done
	exit 0
fi

if [[ "$CREATE_BRANCH" == true ]]; then
	current_branch="$(git -C "${REPO_ROOT}" branch --show-current)"
	if [[ "$current_branch" != "$TARGET_BRANCH" ]]; then
		if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${TARGET_BRANCH}"; then
			fail "Local branch already exists: ${TARGET_BRANCH}"
		fi

		git -C "${REPO_ROOT}" switch -c "${TARGET_BRANCH}" >/dev/null
		info "Created branch ${TARGET_BRANCH}"
	fi
fi

write_json_version "${REPO_ROOT}/package.json" "${NEW_VERSION}"
write_json_version "${REPO_ROOT}/apps/spindle/package.json" "${NEW_VERSION}"
write_json_version "${REPO_ROOT}/apps/spindle/src-tauri/tauri.conf.json" "${NEW_VERSION}"
write_toml_version "${REPO_ROOT}/apps/spindle/src-tauri/Cargo.toml" "${CURRENT_VERSION}" "${NEW_VERSION}"
write_toml_version "${REPO_ROOT}/plugins/tauri-plugin-spindle-project/Cargo.toml" "${CURRENT_VERSION}" "${NEW_VERSION}"
refresh_cargo_lock

resolved_version="$("${CHECK_SCRIPT}" --current-version)"
if [[ "$resolved_version" != "$NEW_VERSION" ]]; then
	fail "Version update completed, but the manifest check resolved ${resolved_version} instead of ${NEW_VERSION}"
fi

info
info "Updated release-facing versions to ${NEW_VERSION}:"
for file in "${FILES[@]}"; do
	info "  - ${file}"
done
if [[ -f "${REPO_ROOT}/Cargo.lock" ]]; then
	info "  - Cargo.lock"
fi

info
info "Next steps:"
info "  1. Review the diff"
info "  2. Run pnpm release:version:check"
info "  3. Commit the release preparation branch"
info "  4. Open a pull request against main"
