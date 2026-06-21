#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$PROJECT_DIR/certs"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert 未安装，请先安装 mkcert 并执行 mkcert -install" >&2
  exit 1
fi

mkcert -install
mkcert -cert-file 127.0.0.1.pem -key-file 127.0.0.1-key.pem 127.0.0.1 localhost ::1

echo "证书已生成："
echo "  SSL_CERTFILE=$CERT_DIR/127.0.0.1.pem"
echo "  SSL_KEYFILE=$CERT_DIR/127.0.0.1-key.pem"
