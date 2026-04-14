# Obsidian Provenance

Track and visually highlight text written by AI vs human in your Obsidian notes.

## v2.0.0 — New Detection Approach

**Default: everything is human.** AI content is only tagged from three known sources:

### 1. BotWick Edits (Marker-Based)
When BotWick writes to a file, it adds `<!-- ai -->` as an invisible HTML comment to its blocks. The plugin detects this marker, tags the block as AI, and the comment is invisible in rendered view.

### 2. Granola Notes (Structural)
Detected by `granola_id` in frontmatter. The entire note body (summaries, action items, key takeaways) is AI-generated. Frontmatter and transcript links are human.

### 3. Snipd Podcast Notes (Structural)
Detected by `from_snipd: true` in frontmatter:
- **AI**: Section titles, bullet summaries, episode AI descriptions
- **Human**: Blockquotes, transcripts, quotes, timestamps

### No More False Positives
Previous versions tagged any non-keyboard write as AI, causing false positives from:
- Obsidian frontmatter updates
- Obsidian Sync
- Linter/Templater plugins
- Properties panel edits

v2.0.0 eliminates all of these by flipping the default.

## Visual Highlighting
- AI blocks get a **blue left border** and subtle background tint
- Status bar shows "✦ X AI blocks" for the active note
- Toggle via ribbon icon or command palette

## Install via BRAT
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add: `borthwick/obsidian-provenance`

## License
MIT
