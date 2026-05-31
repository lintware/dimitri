#!/bin/bash
# Dimitri Auto-Provisioning Script

set -e

echo "🧬 Dimitri Chemistry Harness - Auto Provisioning"

echo "Checking for Miniconda..."
if ! command -v conda &> /dev/null; then
    echo "Installing Miniconda..."
    wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O miniconda.sh
    bash miniconda.sh -b -p $HOME/miniconda
    export PATH="$HOME/miniconda/bin:$PATH"
fi

conda env list | grep -q dimitri || {
    echo "Creating dimitri conda environment..."
    conda create -y -n dimitri python=3.11
}

source activate dimitri || conda activate dimitri

pip install rdkit openbabel deepchem pandas

# Docking tools
conda install -y -c conda-forge vina

pip install git+https://github.com/gcorso/DiffDock.git  # or prebuilt

echo "✅ Dimitri environment ready!"