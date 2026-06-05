#!/bin/bash
# ============================================================
# Local Development Startup Script
# Starts PostgreSQL, pushes schema, seeds data, and runs apps
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADMIN_DIR="$SCRIPT_DIR/ecommerce-admin"
STORE_DIR="$SCRIPT_DIR/ecommerce-store"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  🐳 Ecommerce Local Dev Setup${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"

# ──────────────────────────────────────────
# 1. Start PostgreSQL
# ──────────────────────────────────────────
echo -e "\n${YELLOW}[1/5]${NC} Starting PostgreSQL container..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

# Wait for PostgreSQL to be ready
echo -n "Waiting for PostgreSQL to be ready"
for i in $(seq 1 30); do
  if docker exec ecomm-postgres pg_isready -U ecomm -d ecommerce > /dev/null 2>&1; then
    echo -e " ${GREEN}✓${NC}"
    break
  fi
  echo -n "."
  sleep 1
  if [ $i -eq 30 ]; then
    echo -e "\n❌ PostgreSQL failed to start within 30 seconds"
    exit 1
  fi
done

# ──────────────────────────────────────────
# 2. Push Prisma Schema
# ──────────────────────────────────────────
echo -e "\n${YELLOW}[2/5]${NC} Pushing Prisma schema to database..."
cd "$ADMIN_DIR"
npx prisma db push

# ──────────────────────────────────────────
# 3. Generate Prisma Client
# ──────────────────────────────────────────
echo -e "\n${YELLOW}[3/5]${NC} Generating Prisma client..."
npx prisma generate

# ──────────────────────────────────────────
# 4. Seed Database
# ──────────────────────────────────────────
echo -e "\n${YELLOW}[4/5]${NC} Seeding database..."
npx tsx prisma/seed.ts

# ──────────────────────────────────────────
# 5. Instructions
# ──────────────────────────────────────────
echo -e "\n${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Local environment is ready!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Start the admin:${NC}"
echo "    cd ecommerce-admin && npm run dev"
echo ""
echo -e "  ${YELLOW}Start the store (separate terminal):${NC}"
echo "    cd ecommerce-store && npm run dev -- -p 3002"
echo ""
echo -e "  ${YELLOW}View database:${NC}"
echo "    cd ecommerce-admin && npm run db:studio"
echo ""
echo -e "  ${YELLOW}Stop PostgreSQL:${NC}"
echo "    docker compose down"
echo ""
echo -e "  ${BLUE}Admin:${NC} http://localhost:3000"
echo -e "  ${BLUE}Store:${NC} http://localhost:3002"
echo ""
