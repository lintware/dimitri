#!/bin/bash
# Dimitri Chemistry Harness - uv-first Auto Provisioning
set -e

echo "🧬 Dimitri — Setting up real molecular design engine (uv + RDKit)"

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Installing uv (fast Python package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "✅ uv found: $(uv --version)"

# Go to the backend directory (where the real chemistry lives)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"

if [ ! -d "$BACKEND_DIR" ]; then
    echo "❌ backend/ directory not found. Are you inside the dimitri package?"
    exit 1
fi

cd "$BACKEND_DIR"

echo "Creating uv environment and installing RDKit + chemistry stack (this downloads ~30MB)..."
uv sync --dev

echo ""
echo "✅ Dimitri chemistry backend ready!"
echo ""
echo "Test it right now:"
echo "  cd backend"
echo "  uv run dimitri-chem generate --scaffold 'NCCc1c[nH]c2ccccc12' --count 80 --top 8"
echo ""
echo "When using inside Pi, the extension will call this automatically."
echo "You can also use /chem generate <scaffold> from inside Pi."
