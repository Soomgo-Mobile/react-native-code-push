#!/usr/bin/env python3
"""Temporary adapter for testing Speedrun in the manual E2E workflow."""

import os
from pathlib import Path
import re
import shutil
import sys


poc_dir = Path(os.environ["SPEEDRUN_POC_DIR"])
repo_e2e = Path(__file__).resolve().parent

if Path(sys.argv[0]).name in ("maestro", "maestro-runner"):
    args = sys.argv[1:]
    flow = Path(args[-1]).resolve()
    args[-1] = str(poc_dir / "flows" / flow.relative_to(Path.cwd() / "e2e"))
    if Path(sys.argv[0]).name == "maestro":
        args[1:1] = ["--animations", "normal", "--debug-output", str(poc_dir / "debug")]
    else:
        output = args.index("--output")
        args[output:output + 2] = ["--debug-output", str(poc_dir / "debug")]
    os.execv(str(poc_dir / "speedrun"), ["speedrun", *args])

flows_dir = poc_dir / "flows"
for source in repo_e2e.iterdir():
    if source.is_dir() and (source.name.startswith("flows") or source.name == "scripts"):
        shutil.copytree(source, flows_dir / source.name, dirs_exist_ok=True)

for flow in flows_dir.rglob("*.yaml"):
    def expand_case(match):
        pattern = match.group(1)
        return '"' + "".join(
            f"[{char.lower()}{char.upper()}]" if char.isascii() and char.isalpha() else char
            for char in pattern
        ) + '"'

    flow.write_text(re.sub(r'"\(\?i\)([^"\n]*)"', expand_case, flow.read_text()))

bin_dir = poc_dir / "bin"
bin_dir.mkdir(parents=True, exist_ok=True)
for name in ("maestro", "maestro-runner"):
    wrapper = bin_dir / name
    shutil.copyfile(__file__, wrapper)
    wrapper.chmod(0o755)
