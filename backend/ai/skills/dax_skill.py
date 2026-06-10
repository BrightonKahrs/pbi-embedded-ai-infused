"""DAX expert skill loader (file-based).

Loads the agentskills.io-style skill at ``ai/skills/dax-expert/SKILL.md``
through ``FileSkillsSource``. The skill carries the entire data-model
documentation and DAX authoring rules so the agent has a single,
authoritative source of truth.
"""
from pathlib import Path

from agent_framework._skills import FileSkillsSource


SKILL_DIR = Path(__file__).resolve().parent / "dax-expert"


def build_dax_skills_source() -> FileSkillsSource:
    """Return a FileSkillsSource pointing at the bundled DAX expert skill."""
    if not (SKILL_DIR / "SKILL.md").exists():
        raise FileNotFoundError(f"DAX skill SKILL.md not found at {SKILL_DIR}")
    return FileSkillsSource([str(SKILL_DIR)])
