---
name: edit-video
description: Edit the user's videos with AgentShot on their computer. Use when the user wants to cut, trim, caption, reframe, add titles, music or sound to, or export a video, or asks about their AgentShot projects.
---

# Editing video with AgentShot

AgentShot is a video editor on the user's own computer. Its `agentshot` tools edit the project the user has open in
it, and the user watches the result there. A new cut arrives in AgentShot as a before/after they keep or send back.

## Setup

If a tool says editing from other agents is switched off, ask the user to open AgentShot → **Settings → Keys** and
switch on **Edit from Claude Code or Codex**. If it says AgentShot isn't open, ask them to open it. Nothing else is
needed: there is no code or password to pass on.

## The workflow

1. **Which project.** `projects` lists the projects open in AgentShot. Every other tool takes an optional `project`
   (a name from that list); without it, the one opened last is used. Open a new one in AgentShot itself.
2. **Know it first.** Start with `project_state`: the versions, the current one, the edit's pieces, open notes and
   the files. Before deciding anything about footage, read it: `transcript` (words with times), `analyze_video`
   (shots, shake, exposure, loudness, silence), `speakers`, `find_subjects`, `look` (frames at chosen times),
   `search_footage` (a moment by what's shown or said).
3. **Edit.**
   - Plain cuts, trims, reordering and volume: `edit_timeline`. It changes the edit at once, without rendering, and
     the user can undo it. Cut speech on the transcript's word times.
   - Anything else: the `ffmpeg` tool (read the current version, write to `renders/`, never overwrite `media/`), then
     `propose_version`. Make one proposal per request.
   - Titles, lower thirds and captions are motion clips: `create_clip`, then `insert_clip` or `overlay_clip`.
   - A file from elsewhere on this computer: `add_files` (an absolute path) first.
4. **Review.** Tell the user what changed and ask them to keep it or send it back in AgentShot. Use `decide_version`
   to keep or drop a proposal only when they ask you to.
5. **Export.** `export_video` when they want the file.

The project folder is yours to read; change the film only through these tools.
