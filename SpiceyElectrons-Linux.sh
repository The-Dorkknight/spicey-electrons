#!/bin/sh
# Spicey Electrons - double-click launcher for Linux (Linux Mint, Ubuntu, Bazzite, Nobara...)
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
cd "$(dirname "$0")" || exit 1

# If we were double-clicked without a terminal, reopen in one so messages stay visible.
if [ ! -t 1 ] && [ -z "$SE_IN_TERMINAL" ]; then
  export SE_IN_TERMINAL=1
  for t in x-terminal-emulator gnome-terminal konsole xfce4-terminal mate-terminal xterm; do
    if command -v "$t" >/dev/null 2>&1; then
      case "$t" in
        gnome-terminal) exec "$t" -- sh "$0" ;;
        *) exec "$t" -e sh "$0" ;;
      esac
    fi
  done
fi

pause() { printf '\nPress Enter to close this window...'; read -r _; }

PY=""
for p in python3 python; do
  if command -v "$p" >/dev/null 2>&1; then PY="$p"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3 is needed but wasn't found."
  echo "Linux Mint / Ubuntu:  sudo apt install python3"
  pause; exit 1
fi

if ! command -v ngspice >/dev/null 2>&1 && [ ! -x /home/linuxbrew/.linuxbrew/bin/ngspice ]; then
  echo "The simulation engine (ngspice) is not installed yet."
  if command -v apt-get >/dev/null 2>&1; then
    printf "Install it now with 'sudo apt install ngspice'? (asks for your password) [Y/n] "
    read -r a
    case "$a" in n*|N*) ;; *) sudo apt-get install -y ngspice ;; esac
  elif command -v brew >/dev/null 2>&1 || [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
    BREW=$(command -v brew || echo /home/linuxbrew/.linuxbrew/bin/brew)
    printf "Install it now with Homebrew ('brew install ngspice', no password needed)? [Y/n] "
    read -r a
    case "$a" in n*|N*) ;; *) "$BREW" install ngspice ;; esac
  elif command -v dnf >/dev/null 2>&1; then
    printf "Install it now with 'sudo dnf install ngspice'? [Y/n] "
    read -r a
    case "$a" in n*|N*) ;; *) sudo dnf install -y ngspice ;; esac
  else
    echo "Please install the 'ngspice' package with your software manager, then run this again."
  fi
fi

echo "Starting Spicey Electrons... (close this window to quit)"
"$PY" src/main.py "$@" || pause
