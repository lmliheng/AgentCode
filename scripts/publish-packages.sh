#!/usr/bin/env bash
#
# 按拓扑顺序发布 packages/ 下的可发布包。
#
# 为什么不是一个 `pnpm -r publish`：
#   - 顺序要明确（core → providers/tools → runtime → cli）。名字解析不到版本时
#     pnpm 的递归发布只会在**发了一半之后**才报错，那时 npm 上已经留下几个半成品；
#   - 已经发过的版本必须跳过而不是报错重来，「重跑一次工作流」应当总是安全的；
#   - 私有包（myrag / mcp-host / mcp-cloud / memory-short）不能顺手带出去。
#
# 用法：
#   bash scripts/publish-packages.sh --registry=https://registry.npmjs.org [--dry-run]
#
# 认证走 .npmrc（CI 里由 setup-node 与工作流写入，本地是 `npm login` 或 ~/.npmrc）。
set -euo pipefail

REGISTRY=""
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --registry=*) REGISTRY="${arg#--registry=}" ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [ -z "$REGISTRY" ]; then
  echo "必须给 --registry（例如 --registry=https://registry.npmjs.org）" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# 拓扑顺序：库在前，依赖它们的 cli 在后
PACKAGES=(
  packages/core
  packages/providers
  packages/tools
  packages/runtime
  packages/cli
)

published=0
skipped=0

for dir in "${PACKAGES[@]}"; do
  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")
  private=$(node -p "require('./$dir/package.json').private === true")

  if [ "$private" = "true" ]; then
    echo "· 跳过 $name（private）"
    skipped=$((skipped + 1))
    continue
  fi

  # 查这个**具体版本**而不是整个包：包级接口在部分网络里会被缓存成陈旧的 404，
  # 而版本级接口是权威的（本地那次发布就是栽在这上面）
  if npm view "$name@$version" version --registry="$REGISTRY" >/dev/null 2>&1; then
    echo "· 跳过 $name@$version（该版本已存在）"
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "· [dry-run] 将发布 $name@$version → $REGISTRY"
    (cd "$dir" && pnpm pack --pack-destination "${RUNNER_TEMP:-/tmp}" >/dev/null)
    continue
  fi

  echo "· 发布 $name@$version → $REGISTRY"
  (cd "$dir" && pnpm publish --access public --no-git-checks --registry="$REGISTRY")
  published=$((published + 1))
done

echo "完成：发布 $published 个，跳过 $skipped 个"
