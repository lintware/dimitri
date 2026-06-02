"""
Standalone CLI for Dimitri Chemistry Engine.

Useful for testing the molecular designer outside of Pi,
and for quick design campaigns from the terminal.
"""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich import print as rprint
from rich.table import Table

from .library import DesignLibrary

app = typer.Typer(help="Dimitri Chemistry — Molecular Designer CLI (RDKit powered)")


@app.command()
def generate(
    scaffold: str = typer.Option(..., "--scaffold", "-s", help="Core SMILES (can include * for attachment points)"),
    count: int = typer.Option(400, "--count", "-n", help="Number of analogs to generate"),
    name: str = typer.Option("design_campaign", "--name", help="Name for this library"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Write results to JSON"),
    top: int = typer.Option(20, "--top", help="How many top compounds to show"),
):
    """Generate a focused analog library from a scaffold and score it."""
    rprint(f"[bold cyan]Dimitri Chemistry Designer[/] — generating {count} analogs from scaffold")
    rprint(f"Scaffold: [yellow]{scaffold}[/]")

    lib = DesignLibrary(name=name)
    added = lib.generate_from_scaffold(scaffold, count=count)

    rprint(f"[green]Generated {added} unique valid analogs[/]")

    lib.rank_and_filter(min_score=0.50, top_n=200)

    rprint(f"\n[bold]Top {top} compounds after scoring & filtering:[/]")
    _print_top_table(lib, top)

    if output:
        lib.to_json(output)
        rprint(f"\n[green]Saved full library → {output}[/]")

    summary = lib.summary()
    rprint(f"\n[bold]Campaign summary:[/] {json.dumps(summary, indent=2)}")


@app.command()
def score(
    smiles: str = typer.Argument(..., help="SMILES of the molecule to score"),
):
    """Score a single molecule with the tryptamine designer MPO."""
    from .molecule import Molecule

    m = Molecule(smiles=smiles)
    rprint(f"[bold]SMILES:[/] {smiles}")
    rprint(f"[bold]Designer Score:[/] [green]{m.score:.4f}[/]")
    rprint("Breakdown:")
    for k, v in m.score_breakdown.items():
        rprint(f"  {k:25s} {v:.3f}")


def _print_top_table(lib: DesignLibrary, n: int) -> None:
    table = Table(title="Top Designed Compounds")
    table.add_column("Rank", style="cyan")
    table.add_column("SMILES", style="yellow", no_wrap=True)
    table.add_column("MW", justify="right")
    table.add_column("LogP", justify="right")
    table.add_column("TPSA", justify="right")
    table.add_column("QED", justify="right")
    table.add_column("Score", justify="right", style="green")

    for i, c in enumerate(lib.top_n(n), 1):
        p = c.properties
        table.add_row(
            str(i),
            c.smiles[:42] + ("..." if len(c.smiles) > 42 else ""),
            f"{p['mw']:.1f}",
            f"{p['logp']:.2f}",
            f"{p['tpsa']:.1f}",
            f"{p['qed']:.3f}",
            f"{c.score:.3f}",
        )

    rprint(table)


if __name__ == "__main__":
    app()
