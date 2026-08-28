#!/usr/bin/env bash
# 9Router 云端部署脚本（方式 B：服务器上 clone 你的 fork 后构建）
# 用法：
#   1. 将本文件上传到云服务器（如 /root/deploy-9router.sh）
#   2. chmod +x deploy-9router.sh
#   3. ./deploy-9router.sh
#
# 前置要求：Ubuntu 22.04+，已安装 git 和 Docker + Docker Compose

set -e

REPO_URL="https://github.com/wcy92929292/9router.git"
DEPLOY_DIR="$HOME/9router-deploy"
BRANCH="master"

echo "==> [1/6] 安装 Docker（如已安装会跳过）"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  echo "Docker 安装完成"
else
  echo "Docker 已存在，跳过"
fi

echo "==> [2/6] 克隆/更新代码"
if [ -d "$DEPLOY_DIR" ]; then
  cd "$DEPLOY_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
  echo "代码已更新到最新"
else
  git clone "$REPO_URL" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  git checkout "$BRANCH"
  echo "代码已克隆"
fi

echo "==> [3/6] 检查 .env 文件"
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "⚠️  未找到 .env，请从 .env.example 复制并填入真实密钥："
  echo "    cp .env.example .env"
  echo "    # 然后编辑 .env，至少修改 JWT_SECRET 和 INITIAL_PASSWORD"
  echo "    # 生成随机 JWT_SECRET:  openssl rand -base64 48"
  echo ""
  echo "请先创建 .env 后重新运行本脚本。"
  exit 1
fi
echo ".env 已存在，继续"

echo "==> [4/6] 构建并启动容器"
cd "$DEPLOY_DIR"
docker compose up -d --build

echo "==> [5/6] 等待服务启动"
sleep 15
if curl -fsS http://localhost:20128/login >/dev/null 2>&1; then
  echo "✅ 服务已启动： http://localhost:20128"
else
  echo "⚠️  服务可能还在启动，查看日志： docker compose logs -f"
fi

echo "==> [6/6] 后续步骤提示"
echo "--------------------------------------------------------"
echo "1. 登录仪表盘： http://<服务器IP>:20128  (用 .env 里的 INITIAL_PASSWORD)"
echo "2. 如需 HTTPS：用 Nginx + certbot 反代 20128 端口，并设 AUTH_COOKIE_SECURE=true"
echo "3. 给 50 个用户发独立 API Key：Dashboard -> API Keys -> 逐个创建"
echo "4. 配置多个上游账号分散配额：Dashboard -> Providers"
echo "5. 数据备份： docker compose exec 9router tar czf - /app/data > backup.tar.gz"
echo "6. 查看日志： docker compose logs -f"
echo "7. 更新代码： 重新运行本脚本即可（会自动 git pull + 重建）"
echo "--------------------------------------------------------"
