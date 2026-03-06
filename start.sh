#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────
#  QuantEdge Trading Platform — Startup Script
# ─────────────────────────────────────────────

RESET="\033[0m"
BOLD="\033[1m"
BLUE="\033[34m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
DIM="\033[2m"

BACKEND_PORT=8000
FRONTEND_PORT=3000
BACKEND_PID_FILE=".backend.pid"
FRONTEND_PID_FILE=".frontend.pid"
LOG_DIR="logs"

print_banner() {
  echo ""
  echo -e "${BLUE}${BOLD}  ◈  Q U A N T E D G E   T R A D I N G   P L A T F O R M${RESET}"
  echo -e "${DIM}  ──────────────────────────────────────────────────────${RESET}"
  echo ""
}

log_info()    { echo -e "  ${CYAN}→${RESET}  $1"; }
log_success() { echo -e "  ${GREEN}✓${RESET}  $1"; }
log_warn()    { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
log_error()   { echo -e "  ${RED}✗${RESET}  $1"; }
log_dim()     { echo -e "  ${DIM}$1${RESET}"; }

# ── Helpers ────────────────────────────────────

check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "Required command not found: ${BOLD}$1${RESET}"
    echo ""
    case "$1" in
      python3|python) echo -e "  Install Python 3.10+: ${CYAN}https://python.org${RESET}" ;;
      node)           echo -e "  Install Node.js 18+:  ${CYAN}https://nodejs.org${RESET}" ;;
      npm)            echo -e "  Install npm (comes with Node.js)" ;;
    esac
    echo ""
    exit 1
  fi
}

port_in_use() {
  lsof -i ":$1" &>/dev/null 2>&1
}

kill_pid_file() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && log_success "Stopped process $pid"
    fi
    rm -f "$file"
  fi
}

cleanup() {
  echo ""
  log_warn "Shutting down servers…"
  kill_pid_file "$BACKEND_PID_FILE"
  kill_pid_file "$FRONTEND_PID_FILE"
  # Also kill any child processes in our process group
  kill 0 2>/dev/null
  echo ""
  log_success "All servers stopped. Goodbye."
  exit 0
}

# ── Setup ──────────────────────────────────────

setup_backend() {
  log_info "Setting up backend…"

  cd backend

  # Check for .env
  if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
      cp .env.example .env
      log_warn ".env not found — copied from .env.example"
      log_warn "Edit ${BOLD}backend/.env${RESET}${YELLOW} and add your ALPACA_API_KEY / ALPACA_SECRET_KEY"
    else
      log_error ".env.example not found in backend/"
      exit 1
    fi
  fi

  # Create/activate virtualenv
  if [ ! -d "venv" ]; then
    log_info "Creating Python virtual environment…"
    python3 -m venv venv
  fi

  source venv/bin/activate

  # Install dependencies (only if requirements.txt is newer than venv)
  if [ requirements.txt -nt venv/pyvenv.cfg ] || [ ! -f venv/lib/python*/site-packages/fastapi/__init__.py ] 2>/dev/null; then
    log_info "Installing Python dependencies (this may take a minute)…"
    pip install --upgrade pip -q
    if ! pip install -r requirements.txt; then
      log_error "pip install failed — check your internet connection and requirements.txt"
      exit 1
    fi
    log_success "Python dependencies installed"
  else
    log_success "Python dependencies already up to date"
  fi

  cd ..
}

setup_frontend() {
  log_info "Setting up frontend…"

  cd frontend

  if [ ! -d "node_modules" ]; then
    log_info "Installing Node dependencies (this may take a minute)…"
    npm install --silent
    log_success "Node dependencies installed"
  else
    # Check if package.json changed since last install
    if [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
      log_info "package.json changed — updating dependencies…"
      npm install --silent
      log_success "Node dependencies updated"
    else
      log_success "Node dependencies already up to date"
    fi
  fi

  cd ..
}

# ── Start Servers ──────────────────────────────

start_backend() {
  cd backend
  source venv/bin/activate

  if port_in_use $BACKEND_PORT; then
    log_warn "Port $BACKEND_PORT already in use — skipping backend start"
    cd ..
    return
  fi

  mkdir -p "../$LOG_DIR"
  nohup uvicorn app.main:app \
    --host 0.0.0.0 \
    --port $BACKEND_PORT \
    --reload \
    --log-level info \
    > "../$LOG_DIR/backend.log" 2>&1 &

  echo $! > "../$BACKEND_PID_FILE"
  log_success "Backend started ${DIM}(PID $(cat ../$BACKEND_PID_FILE))${RESET}"
  cd ..
}

start_frontend() {
  cd frontend

  if port_in_use $FRONTEND_PORT; then
    log_warn "Port $FRONTEND_PORT already in use — skipping frontend start"
    cd ..
    return
  fi

  mkdir -p "../$LOG_DIR"
  nohup npm run dev -- --port $FRONTEND_PORT \
    > "../$LOG_DIR/frontend.log" 2>&1 &

  echo $! > "../$FRONTEND_PID_FILE"
  log_success "Frontend started ${DIM}(PID $(cat ../$FRONTEND_PID_FILE))${RESET}"
  cd ..
}

wait_for_backend() {
  local attempts=0
  local max=30
  local spin_chars=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local backend_pid
  backend_pid=$(cat "$BACKEND_PID_FILE" 2>/dev/null)

  printf "  ${CYAN}→${RESET}  Starting backend"

  while ! curl -sf "http://localhost:$BACKEND_PORT/health/" > /dev/null 2>&1; do
    # Check if the backend process is still alive
    if [ -n "$backend_pid" ] && ! kill -0 "$backend_pid" 2>/dev/null; then
      printf "\r  ${RED}✗${RESET}  Backend process crashed                    \n\n"
      echo -e "  ${BOLD}${RED}Backend failed to start. Last log output:${RESET}"
      echo -e "  ${DIM}────────────────────────────────────────────${RESET}"
      tail -n 20 "$LOG_DIR/backend.log" 2>/dev/null | sed 's/^/  /'
      echo -e "  ${DIM}────────────────────────────────────────────${RESET}"
      echo ""
      echo -e "  ${YELLOW}Common fixes:${RESET}"
      echo -e "    ${DIM}1. Check backend/.env has valid ALPACA_API_KEY / ALPACA_SECRET_KEY${RESET}"
      echo -e "    ${DIM}2. Run:  cd backend && source venv/bin/activate && uvicorn app.main:app${RESET}"
      echo -e "    ${DIM}3. Check full logs: ./start.sh logs backend${RESET}"
      echo ""
      return 1
    fi

    attempts=$((attempts + 1))
    if [ $attempts -ge $max ]; then
      printf "\r  ${YELLOW}⚠${RESET}  Backend health check timed out after ${max}s          \n\n"
      echo -e "  ${BOLD}Last log output:${RESET}"
      echo -e "  ${DIM}────────────────────────────────────────────${RESET}"
      tail -n 20 "$LOG_DIR/backend.log" 2>/dev/null | sed 's/^/  /'
      echo -e "  ${DIM}────────────────────────────────────────────${RESET}"
      echo ""
      echo -e "  ${DIM}Full logs: ./start.sh logs backend${RESET}"
      echo ""
      return 1
    fi

    local spin="${spin_chars[$((attempts % ${#spin_chars[@]}))]}"
    printf "\r  ${CYAN}${spin}${RESET}  Starting backend… ${DIM}(${attempts}s)${RESET}   "
    sleep 1
  done

  printf "\r  ${GREEN}✓${RESET}  Backend is ready                    \n"
}

# ── Commands ───────────────────────────────────

cmd_start() {
  print_banner

  # Prerequisites
  check_command python3
  check_command node
  check_command npm

  echo -e "  ${BOLD}Checking dependencies…${RESET}"
  echo ""
  setup_backend
  setup_frontend
  echo ""

  echo -e "  ${BOLD}Starting servers…${RESET}"
  echo ""
  trap cleanup INT TERM

  start_backend
  start_frontend

  echo ""
  wait_for_backend
  echo ""

  echo -e "  ${BOLD}${GREEN}All systems go!${RESET}"
  echo ""
  echo -e "  ${BLUE}◈  Frontend${RESET}   →  ${CYAN}http://localhost:$FRONTEND_PORT${RESET}"
  echo -e "  ${BLUE}◈  Backend API${RESET} →  ${CYAN}http://localhost:$BACKEND_PORT${RESET}"
  echo -e "  ${BLUE}◈  API Docs${RESET}   →  ${CYAN}http://localhost:$BACKEND_PORT/docs${RESET}"
  echo ""
  echo -e "  ${DIM}Logs: logs/backend.log  |  logs/frontend.log${RESET}"
  echo -e "  ${DIM}Press Ctrl+C to stop all servers${RESET}"
  echo ""

  # Keep script alive so Ctrl+C triggers cleanup
  wait
}

cmd_stop() {
  print_banner
  log_info "Stopping servers…"
  kill_pid_file "$BACKEND_PID_FILE"
  kill_pid_file "$FRONTEND_PID_FILE"

  # Also kill by port as fallback
  for port in $BACKEND_PORT $FRONTEND_PORT; do
    local pid
    pid=$(lsof -ti ":$port" 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      log_success "Killed process on port $port"
    fi
  done
  log_success "Done"
}

cmd_status() {
  print_banner
  echo -e "  ${BOLD}Server Status${RESET}"
  echo ""

  if port_in_use $BACKEND_PORT; then
    log_success "Backend  running on port $BACKEND_PORT"
    # Check health endpoint
    if curl -sf "http://localhost:$BACKEND_PORT/health/" > /dev/null 2>&1; then
      log_dim "  Health check: OK"
    else
      log_warn "  Health check: not responding"
    fi
  else
    log_error "Backend  not running (port $BACKEND_PORT is free)"
  fi

  echo ""

  if port_in_use $FRONTEND_PORT; then
    log_success "Frontend running on port $FRONTEND_PORT"
  else
    log_error "Frontend not running (port $FRONTEND_PORT is free)"
  fi

  echo ""
}

cmd_logs() {
  local service="${1:-all}"
  case "$service" in
    backend)  tail -f "$LOG_DIR/backend.log" ;;
    frontend) tail -f "$LOG_DIR/frontend.log" ;;
    *)
      # Show both side by side using multitail if available, else alternate
      if command -v multitail &>/dev/null; then
        multitail "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
      else
        tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
      fi
      ;;
  esac
}

cmd_test() {
  print_banner
  log_info "Running backend test suite…"
  echo ""
  cd backend
  source venv/bin/activate 2>/dev/null || true
  pytest tests/ -v --tb=short
  cd ..
}

cmd_help() {
  print_banner
  echo -e "  ${BOLD}Usage:${RESET}  ./start.sh [command]"
  echo ""
  echo -e "  ${BOLD}Commands:${RESET}"
  echo -e "    ${CYAN}start${RESET}            Start both frontend and backend ${DIM}(default)${RESET}"
  echo -e "    ${CYAN}stop${RESET}             Stop all running servers"
  echo -e "    ${CYAN}status${RESET}           Show server status and health"
  echo -e "    ${CYAN}logs${RESET}             Tail logs for both servers"
  echo -e "    ${CYAN}logs backend${RESET}     Tail backend logs only"
  echo -e "    ${CYAN}logs frontend${RESET}    Tail frontend logs only"
  echo -e "    ${CYAN}test${RESET}             Run the backend test suite"
  echo -e "    ${CYAN}help${RESET}             Show this help message"
  echo ""
  echo -e "  ${BOLD}Examples:${RESET}"
  echo -e "    ${DIM}./start.sh${RESET}               # start everything"
  echo -e "    ${DIM}./start.sh stop${RESET}          # stop everything"
  echo -e "    ${DIM}./start.sh logs backend${RESET}  # tail backend logs"
  echo ""
}

# ── Entry Point ────────────────────────────────

# Ensure we run from the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "${1:-start}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  test)    cmd_test ;;
  help|-h|--help) cmd_help ;;
  *)
    log_error "Unknown command: $1"
    echo ""
    cmd_help
    exit 1
    ;;
esac
