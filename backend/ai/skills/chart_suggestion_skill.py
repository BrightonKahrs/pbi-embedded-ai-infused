"""Chart-suggestion skill loader (file-based).

Loads the agentskills.io-style skill at
``ai/skills/chart-suggestion/SKILL.md`` through ``FileSkillsSource``.
The skill teaches the visual creator how to pick a sensible default
Power BI visual config for inline chat previews.
"""
from pathlib import Path

from agent_framework._skills import FileSkillsSource


SKILL_DIR = Path(__file__).resolve().parent / "chart-suggestion"


def build_chart_suggestion_skills_source() -> FileSkillsSource:
    """Return a FileSkillsSource pointing at the bundled chart-suggestion skill."""
    if not (SKILL_DIR / "SKILL.md").exists():
        raise FileNotFoundError(
            f"chart-suggestion SKILL.md not found at {SKILL_DIR}"
        )
    return FileSkillsSource([str(SKILL_DIR)])
