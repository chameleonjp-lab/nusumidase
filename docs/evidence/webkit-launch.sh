#!/bin/bash
set -eu
bundle_dir=/workspace/playwright-browsers/webkit-2311/minibrowser-wpe
export WEBKIT_EXEC_PATH="$bundle_dir/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="$bundle_dir/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="$bundle_dir/share"
export LD_LIBRARY_PATH="/workspace/webkit-libs/root/usr/lib/x86_64-linux-gnu:$bundle_dir/lib:$bundle_dir/sys/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export WEBKIT_FORCE_COMPLEX_TEXT=1
exec "$bundle_dir/bin/MiniBrowser" "$@"
