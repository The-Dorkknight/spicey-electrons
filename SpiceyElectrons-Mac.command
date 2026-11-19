#!/bin/sh
# Spicey Electrons - double-click launcher for macOS.
# First time: right-click this file > Open (it isn't signed by Apple).
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
pause() { printf '\nPress Enter to close this window...'; read -r _; }

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed. A box may pop up offering to install Apple's developer tools - click Install,"
  echo "then double-click this file again."
  xcode-select --install 2>/dev/null
  pause; exit 1
fi

if ! command -v ngspice >/dev/null 2>&1; then
  echo "The simulation engine (ngspice) is not installed yet."
  if command -v brew >/dev/null 2>&1; then
    printf "Install it now with Homebrew ('brew install ngspice')? [Y/n] "
    read -r a
    case "$a" in n*|N*) ;; *) brew install ngspice ;; esac
  else
    echo "The easy way is Homebrew (https://brew.sh): paste its one-line install command into Terminal,"
    echo "then double-click this file again and say Y."
    open "https://brew.sh"
  fi
fi

echo "Starting Spicey Electrons... (close this window to quit)"
python3 src/main.py "$@" || pause
