#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  QuantEdge Trading Platform — Startup Script
# ─────────────────────────────────────────────

RESET="\033[0m";  BOLD="\033[1m";  DIM="\033[2m"
BLUE="\033[34m";  GREEN="\033[32m"; YELLOW="\033[33m"
RED="\033[31m";   CYAN="\033[36m"

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
    case "$1" in
      python3) echo -e "  Install Python 3.10+: ${CYAN}https://python.org${RESET}" ;;
      node|npm) echo -e "  Install Node.js 18+: ${CYAN}https://nodejs.org${RESET}" ;;
    esac
    exit 1
  fi
}

port_in_use() { lsof -i ":$1" &>/dev/null 2>&1; }

kill_on_port() {
  local pid
  pid=$(lsof -ti ":$1" 2>/dev/null)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null && return 0
  return 1
}

kill_pid_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  local pid; pid=$(cat "$file")
  kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null
  rm -f "$file"
}

# ── Setup ──────────────────────────────────────

setup_backend() {
  log_info "Setting up backend…"
  cd backend

  if [ ! -f ".env" ]; then
    [ -f ".env.example" ] && cp .env.example .env && \
      log_warn ".env not found — copied from .env.example (edit backend/.env to add API keys)"
  fi

  if [ ! -d "venv" ]; then
    log_info "Creating Python virtual environment…"
    python3 -m venv venv
  fi

  source venv/bin/activate

  local needs_install=0
  [ requirements.txt -nt venv/pyvenv.cfg ] && needs_install=1
  python3 -c "import fastapi, uvicorn, httpx" 2>/dev/null || needs_install=1

  if [ "$needs_install" -eq 1 ]; then
    log_info "Installing Python dependencies…"
    pip install --upgrade pip -q
    pip install -r requirements.txt -q || { log_error "pip install failed"; cd ..; exit 1; }
    log_success "Python dependencies installed"
  else
    log_success "Python dependencies up to date"
  fi

  cd ..
}

setup_frontend() {
  log_info "Setting up frontend…"
  cd frontend

  local needs_install=0
  [ ! -d "node_modules" ] && needs_install=1
  [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null && needs_install=1

  if [ "$needs_install" -eq 1 ]; then
    log_info "Installing Node dependencies…"
    npm install --silent || { log_error "npm install failed"; cd ..; exit 1; }
    log_success "Node dependencies installed"
  else
    log_success "Node dependencies up to date"
  fi

  cd ..
}

# ── Start Servers ──────────────────────────────

start_backend() {
  cd backend
  source venv/bin/activate

  if port_in_use $BACKEND_PORT; then
    log_warn "Port $BACKEND_PORT already in use — assuming backend is running"
    cd ..; return 0
  fi

  mkdir -p "../$LOG_DIR"
  # Clear previous log so we tail fresh output
  > "../$LOG_DIR/backend.log"

  nohup uvicorn app.main:app \
    --host 0.0.0.0 \
    --port $BACKEND_PORT \
    --reload \
    --log-level info \
    > "../$LOG_DIR/backend.log" 2>&1 &

  local pid=$!
  echo "$pid" > "../$BACKEND_PID_FILE"
  log_success "Backend starting  ${DIM}(PID $pid · logs/$LOG_DIR/backend.log)${RESET}"
  cd ..
}

start_frontend() {
  cd frontend

  if port_in_use $FRONTEND_PORT; then
    log_warn "Port $FRONTEND_PORT already in use — assuming frontend is running"
    cd ..; return 0
  fi

  mkdir -p "../$LOG_DIR"
  > "../$LOG_DIR/frontend.log"

  nohup npm run dev -- --port $FRONTEND_PORT \
    > "../$LOG_DIR/frontend.log" 2>&1 &

  local pid=$!
  echo "$pid" > "../$FRONTEND_PID_FILE"
  log_success "Frontend starting ${DIM}(PID $pid · logs/$LOG_DIR/frontend.log)${RESET}"
  cd ..
}

# Wait for backend to respond, streaming log output
wait_for_backend() {
  local attempt=0
  local max=60          # 60 seconds is plenty for uvicorn --reload cold start
  local log_pos=0
  local backend_pid
  backend_pid=$(cat "$BACKEND_PID_FILE" 2>/dev/null)

  echo ""
  echo -e "  ${DIM}Waiting for backend on port $BACKEND_PORT…${RESET}"

  while true; do
    # --- Success: health endpoint responded ---
    if curl -sf --max-time 2 "http://localhost:$BACKEND_PORT/health/" > /dev/null 2>&1; then
      echo -e "  ${GREEN}✓${RESET}  Backend ready ${DIM}(${attempt}s)${RESET}"
      return 0
    fi

    # --- Failure: backend process died ---
    if [ -n "$backend_pid" ] && ! kill -0 "$backend_pid" 2>/dev/null; then
      echo ""
      log_error "Backend process exited unexpectedly. Last log output:"
      echo -e "  ${DIM}────────────────────────────────────────${RESET}"
      tail -n 40 "$LOG_DIR/backend.log" 2>/dev/null | while IFS= read -r line; do
        if echo "$line" | grep -qiE "error|traceback|exception|failed|fatal"; then
          echo -e "  ${RED}${line}${RESET}"
        else
          echo "  $line"
        fi
      done
      echo -e "  ${DIM}────────────────────────────────────────${RESET}"
      echo ""
      echo -e "  ${YELLOW}Common fixes:${RESET}"
      log_dim "1. Check backend/.env has ALPACA_API_KEY and ALPACA_SECRET_KEY"
      log_dim "2. Verify Python deps:  cd backend && source venv/bin/activate && pip install -r requirements.txt"
      log_dim "3. Run manually:        cd backend && source venv/bin/activate && uvicorn app.main:app --reload"
      log_dim "4. Full app log:        cat $LOG_DIR/app.log"
      return 1
    fi

    # --- Timeout ---
    if [ "$attempt" -ge "$max" ]; then
      echo ""
      log_warn "Backend did not respond after ${max}s. Last log output:"
      echo -e "  ${DIM}────────────────────────────────────────${RESET}"
      tail -n 20 "$LOG_DIR/backend.log" 2>/dev/null | while IFS= read -r line; do
        if echo "$line" | grep -qiE "error|traceback|exception|failed|fatal"; then
          echo -e "  ${RED}${line}${RESET}"
        else
          echo "  $line"
        fi
      done
      echo -e "  ${DIM}────────────────────────────────────────${RESET}"
      # Also show the structured app.log startup section if it exists
      if [ -f "$LOG_DIR/app.log" ]; then
        echo ""
        log_dim "Startup diagnostics from app.log (last 20 lines):"
        echo -e "  ${DIM}────────────────────────────────────────${RESET}"
        tail -n 20 "$LOG_DIR/app.log" 2>/dev/null | while IFS= read -r line; do
          if echo "$line" | grep -qiE "error|warning|failed|fatal"; then
            echo -e "  ${YELLOW}${line}${RESET}"
          else
            echo -e "  ${DIM}${line}${RESET}"
          fi
        done
        echo -e "  ${DIM}────────────────────────────────────────${RESET}"
      fi
      echo ""
      log_dim "The backend may still be loading. Check: ./start.sh status"
      log_dim "Full logs: ./start.sh logs"
      echo ""
      # Don't exit — servers are still running, just slow to start
      return 0
    fi

    # --- Progress: print any new log lines while waiting ---
    local new_lines
    new_lines=$(tail -n +$((log_pos + 1)) "$LOG_DIR/backend.log" 2>/dev/null | head -n 5)
    if [ -n "$new_lines" ]; then
      echo "$new_lines" | sed 's/^/  /'
      log_pos=$(wc -l < "$LOG_DIR/backend.log" 2>/dev/null || echo 0)
    fi

    attempt=$((attempt + 1))
    # Show a dot every 5 seconds so the user knows something is happening
    if [ $((attempt % 5)) -eq 0 ]; then
      echo -e "  ${DIM}… still starting (${attempt}s elapsed)${RESET}"
    fi
    sleep 1
  done
}

# ── Commands ───────────────────────────────────

cmd_start() {
  print_banner

  check_command python3
  check_command node
  check_command npm

  echo -e "  ${BOLD}Runtime versions${RESET}"
  log_dim "Python : $(python3 --version 2>&1)"
  log_dim "Node   : $(node --version 2>&1)"
  log_dim "npm    : $(npm --version 2>&1)"
  echo ""

  # Warn if backend .env is missing API keys
  if [ -f "backend/.env" ]; then
    if ! grep -q "ALPACA_API_KEY" backend/.env 2>/dev/null || grep -q 'ALPACA_API_KEY=\s*$\|ALPACA_API_KEY=""\|ALPACA_API_KEY=demo' backend/.env 2>/dev/null; then
      log_warn "backend/.env found but ALPACA_API_KEY appears unset — market data will fail"
    else
      log_success "backend/.env looks configured"
    fi
  else
    log_warn "backend/.env not found — API keys will fall back to defaults"
  fi
  echo ""

  echo -e "  ${BOLD}Checking dependencies…${RESET}"
  echo ""
  setup_backend
  setup_frontend
  echo ""

  echo -e "  ${BOLD}Starting servers…${RESET}"
  echo ""
  start_backend
  start_frontend

  wait_for_backend || true   # errors already printed inside; don't abort

  # Detach background jobs from this shell — servers keep running after
  # this script exits, and the terminal is freed immediately.
  disown -a 2>/dev/null || true

  echo ""
  echo -e "  ${BOLD}${GREEN}All systems go!${RESET}  ${DIM}(servers running in background)${RESET}"
  echo ""
  echo -e "  ${BLUE}◈  Frontend  ${RESET}→  ${CYAN}http://localhost:$FRONTEND_PORT${RESET}"
  echo -e "  ${BLUE}◈  API       ${RESET}→  ${CYAN}http://localhost:$BACKEND_PORT${RESET}"
  echo -e "  ${BLUE}◈  API Docs  ${RESET}→  ${CYAN}http://localhost:$BACKEND_PORT/docs${RESET}"
  echo ""
  echo -e "  ${DIM}Servers run in the background — your terminal is free.${RESET}"
  echo -e "  ${DIM}./start.sh stop    — stop all servers${RESET}"
  echo -e "  ${DIM}./start.sh logs    — tail live logs${RESET}"
  echo -e "  ${DIM}./start.sh status  — check server health${RESET}"
  echo ""

  # Try to open browser automatically (macOS: open, Linux: xdg-open)
  if command -v open &>/dev/null; then
    sleep 2 && open "http://localhost:$FRONTEND_PORT" &
    disown $! 2>/dev/null || true
  elif command -v xdg-open &>/dev/null; then
    sleep 2 && xdg-open "http://localhost:$FRONTEND_PORT" &
    disown $! 2>/dev/null || true
  fi
}

cmd_stop() {
  print_banner
  log_info "Stopping servers…"

  kill_pid_file "$BACKEND_PID_FILE"  && log_success "Backend stopped" || true
  kill_pid_file "$FRONTEND_PID_FILE" && log_success "Frontend stopped" || true

  # Fallback: kill by port
  kill_on_port $BACKEND_PORT  && log_success "Killed process on port $BACKEND_PORT"  || true
  kill_on_port $FRONTEND_PORT && log_success "Killed process on port $FRONTEND_PORT" || true

  echo ""
  log_success "Done."
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  print_banner
  echo -e "  ${BOLD}Server Status${RESET}"
  echo ""

  if port_in_use $BACKEND_PORT; then
    if curl -sf --max-time 3 "http://localhost:$BACKEND_PORT/health/" > /dev/null 2>&1; then
      log_success "Backend  running and healthy  (port $BACKEND_PORT)"
    else
      log_warn  "Backend  port $BACKEND_PORT in use but /health/ not responding yet"
    fi
  else
    log_error "Backend  not running (port $BACKEND_PORT is free)"
  fi

  echo ""

  if port_in_use $FRONTEND_PORT; then
    log_success "Frontend running  (port $FRONTEND_PORT)"
  else
    log_error "Frontend not running (port $FRONTEND_PORT is free)"
  fi

  echo ""
}

cmd_logs() {
  local service="${1:-all}"
  mkdir -p "$LOG_DIR"
  case "$service" in
    backend)  tail -f "$LOG_DIR/backend.log" ;;
    frontend) tail -f "$LOG_DIR/frontend.log" ;;
    *)
      if command -v multitail &>/dev/null; then
        multitail -s 2 "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
      else
        echo -e "${DIM}Tailing both logs — backend first, then frontend${RESET}"
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
  echo -e "    ${CYAN}start${RESET}            Start both servers ${DIM}(default — frees terminal when ready)${RESET}"
  echo -e "    ${CYAN}stop${RESET}             Stop all running servers"
  echo -e "    ${CYAN}restart${RESET}          Stop then start"
  echo -e "    ${CYAN}status${RESET}           Show server health"
  echo -e "    ${CYAN}logs${RESET}             Tail logs for both servers"
  echo -e "    ${CYAN}logs backend${RESET}     Tail backend logs only"
  echo -e "    ${CYAN}logs frontend${RESET}    Tail frontend logs only"
  echo -e "    ${CYAN}test${RESET}             Run the backend test suite"
  echo -e "    ${CYAN}help${RESET}             Show this message"
  echo ""
  echo -e "  ${BOLD}Examples:${RESET}"
  echo -e "    ${DIM}./start.sh${RESET}               # start — browser opens automatically"
  echo -e "    ${DIM}./start.sh stop${RESET}          # stop everything"
  echo -e "    ${DIM}./start.sh logs backend${RESET}  # watch backend output"
  echo ""
}

# ── Entry Point ────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "${1:-start}" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  status)   cmd_status ;;
  logs)     cmd_logs "${2:-}" ;;
  test)     cmd_test ;;
  help|-h|--help) cmd_help ;;
  *)
    log_error "Unknown command: $1"
    echo ""
    cmd_help
    exit 1
    ;;
esac
