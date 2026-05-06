var y = Object.defineProperty;
var V = Object.getOwnPropertyDescriptor;
var B = Object.getOwnPropertyNames;
var M = Object.prototype.hasOwnProperty;
var N = (a, i) => { for (var t in i) y(a, t, { get: i[t], enumerable: true }); };
var O = (a, i, t, e) => {
  if (i && typeof i == "object" || typeof i == "function")
    for (let n of B(i)) if (!M.call(a, n) && n !== t)
      y(a, n, { get: () => i[n], enumerable: !(e = V(i, n)) || e.enumerable });
  return a;
};
var H = (a) => O(y({}, "__esModule", { value: true }), a);
var I = {};
N(I, { default: () => w });
module.exports = H(I);

var c = require("obsidian");
var v = require("obsidian");

var VERSION = "2.1.0";

// Legacy inline marker — still recognised for backwards compat, auto-migrated to frontmatter
var AI_MARKER = "<!-- ai -->";

// Frontmatter key that stores space-separated AI paragraph indices (0-based, body only).
// Design: inspired by iainc/Markdown-Annotations — authorship lives separate from prose.
// e.g.  ai_blocks: 2 5 7
var FM_AI_KEY = "ai_blocks";

// ─── Frontmatter Utilities ──────────────────────────────────────────────────

// Returns the character offset just past the closing "---" of the frontmatter block,
// or -1 if the content has no valid frontmatter.
function fmEndOffset(content) {
  if (!content.startsWith("---\n")) return -1;
  var idx = content.indexOf("\n---", 4);
  return idx === -1 ? -1 : idx + 4;
}

// Returns the character offset where body text begins (past frontmatter + leading newlines).
function bodyStart(content) {
  var end = fmEndOffset(content);
  if (end === -1) return 0;
  var rest = content.substring(end);
  var leading = rest.match(/^\n+/);
  return end + (leading ? leading[0].length : 0);
}

// Returns the body text (everything after frontmatter and its trailing newlines).
function bodyText(content) {
  return content.substring(bodyStart(content));
}

// Reads the set of AI block indices from content.
// Primary source: frontmatter ai_blocks value.
// Fallback: legacy <!-- ai --> markers in body blocks (triggers migration path).
function readAiBlocks(content) {
  var fmEnd = fmEndOffset(content);
  if (fmEnd !== -1) {
    var fmClose = content.indexOf("\n---", 4);
    var fmText = content.substring(4, fmClose);
    var m = fmText.match(/^ai_blocks\s*:\s*(.+)$/m);
    if (m) {
      return new Set(
        m[1].trim().replace(/[\[\]]/g, "").split(/[\s,]+/)
          .map(Number).filter(function(n) { return Number.isFinite(n) && n >= 0; })
      );
    }
  }
  // Fallback: detect legacy <!-- ai --> markers
  var body = bodyText(content);
  var blocks = body.split(/\n\n+/);
  var set = new Set();
  blocks.forEach(function(b, i) { if (b.indexOf(AI_MARKER) !== -1) set.add(i); });
  return set;
}

// Returns true if the content contains legacy <!-- ai --> markers (migration needed).
function hasLegacyMarkers(content) {
  return content.indexOf(AI_MARKER) !== -1;
}

// Writes the ai_blocks set into frontmatter, creating frontmatter if absent.
// Removes the key entirely when the set is empty.
function writeAiBlocks(content, aiSet) {
  var val = Array.from(aiSet).sort(function(a, b) { return a - b; }).join(" ");
  var fmEnd = fmEndOffset(content);

  if (fmEnd === -1) {
    if (!val) return content;
    return "---\n" + FM_AI_KEY + ": " + val + "\n---\n\n" + content;
  }

  var fmClose = content.indexOf("\n---", 4);
  var fmText = content.substring(4, fmClose);
  var after = content.substring(fmEnd);
  var keyRe = /^ai_blocks\s*:.*$/m;

  if (val) {
    if (keyRe.test(fmText)) {
      fmText = fmText.replace(keyRe, FM_AI_KEY + ": " + val);
    } else {
      fmText = fmText.trimEnd() + "\n" + FM_AI_KEY + ": " + val;
    }
  } else {
    fmText = fmText.replace(/^ai_blocks\s*:.*\n?/m, "");
  }

  return "---\n" + fmText + "\n---" + after;
}

// Strips legacy <!-- ai --> markers from content (used during migration).
function stripLegacyMarkers(content) {
  return content.replace(/<!-- ai -->/g, "").replace(/\n{3,}/g, "\n\n");
}

// Given a cursor character offset in the full document and the content string,
// returns the 0-based paragraph index in the body that contains that offset.
function blockIdxAtOffset(content, cursorOffset) {
  var bStart = bodyStart(content);
  var body = bodyText(content);
  var rel = cursorOffset - bStart;
  if (rel < 0) return 0; // cursor is in frontmatter — default to first body block

  var blocks = body.split(/\n\n+/);
  var pos = 0;
  for (var i = 0; i < blocks.length; i++) {
    pos += blocks[i].length;
    if (rel <= pos) return i;
    var gap = body.substring(pos).match(/^\n\n+/);
    if (gap) pos += gap[0].length;
  }
  return Math.max(0, blocks.length - 1);
}

// Builds the in-memory provenance object for a regular (non-Snipd, non-Granola) file
// from its frontmatter ai_blocks value.
function provenanceFromFrontmatter(content) {
  var aiSet = readAiBlocks(content);
  var body = bodyText(content);
  var blocks = body.split(/\n\n+/);
  var ts = new Date().toISOString();
  return {
    version: 2,
    source: "frontmatter",
    blocks: blocks.map(function(block, idx) {
      return {
        index: idx,
        author: aiSet.has(idx) ? "ai" : "human",
        ts: ts,
        preview: block.substring(0, 60).replace(/\n/g, " ")
      };
    })
  };
}

// ─── Provenance Store (Snipd / Granola sidecar) ────────────────────────────

var g = class {
  constructor(vault, storageFolder) {
    this.vault = vault;
    this.storageFolder = storageFolder;
  }

  setStorageFolder(f) { this.storageFolder = f; }

  getProvenancePath(filePath) {
    return (0, v.normalizePath)(this.storageFolder + "/" + filePath + ".json");
  }

  async load(filePath) {
    var provPath = this.getProvenancePath(filePath);
    var f = this.vault.getAbstractFileByPath(provPath);
    if (f && f instanceof v.TFile) {
      try { return JSON.parse(await this.vault.read(f)); } catch (e) { return null; }
    }
    try {
      if (await this.vault.adapter.exists(provPath)) {
        return JSON.parse(await this.vault.adapter.read(provPath));
      }
    } catch (e) {}
    return null;
  }

  async save(filePath, data) {
    var provPath = this.getProvenancePath(filePath);
    var json = JSON.stringify(data, null, 2);
    var dir = provPath.substring(0, provPath.lastIndexOf("/"));
    if (dir && !this.vault.getAbstractFileByPath(dir)) {
      await this.vault.createFolder(dir).catch(function() {});
    }
    var existing = this.vault.getAbstractFileByPath(provPath);
    if (existing instanceof v.TFile) {
      await this.vault.modify(existing, json);
    } else {
      await this.vault.create(provPath, json);
    }
  }

  static splitBlocks(text) { return text.split(/\n\n+/); }

  static isSnipd(content) {
    var m = content.match(/^---\n([\s\S]*?)\n---/);
    return m ? /from_snipd:\s*true/m.test(m[1]) : false;
  }

  static isGranola(content) {
    var m = content.match(/^---\n([\s\S]*?)\n---/);
    return m ? /granola_id:/m.test(m[1]) : false;
  }

  // ─── Snipd ───
  static classifySnipBlock(block, inHumanSection) {
    var t = block.trim();
    if (!t) return "human";
    if (t.startsWith("---")) return "human";
    if (t.startsWith(">")) return "human";
    if (/^\*\*[^*]+:\*\*/.test(t)) return inHumanSection ? "human" : "ai";
    if (t.startsWith("<iframe")) return "human";
    if (t.startsWith("![") || t.startsWith("# ") || t.startsWith("## Episode")) return "human";
    if (/^#{2,3}\s/.test(t)) {
      if (/Transcript|Quote/i.test(t)) return "human";
      return "ai";
    }
    if (t.startsWith("🎧")) return "human";
    if (/^-\s/.test(t)) return inHumanSection ? "human" : "ai";
    if (t.startsWith("```")) return "human";
    return inHumanSection ? "human" : "ai";
  }

  static generateSnipdProvenance(content) {
    var blocks = g.splitBlocks(content);
    var ts = new Date().toISOString();
    var inHuman = false;
    return {
      version: 2, source: "snipd",
      blocks: blocks.map(function(block, idx) {
        var t = block.trim();
        if (/Transcript|Quote/i.test(t)) inHuman = true;
        else if (/^#{2,3}\s/.test(t) && !/Transcript|Quote/i.test(t)) inHuman = false;
        return {
          index: idx,
          author: g.classifySnipBlock(block, inHuman),
          ts: ts,
          preview: block.substring(0, 60).replace(/\n/g, " ")
        };
      })
    };
  }

  // ─── Granola ───
  static generateGranolaProvenance(content) {
    var blocks = g.splitBlocks(content);
    var ts = new Date().toISOString();
    return {
      version: 2, source: "granola",
      blocks: blocks.map(function(block, idx) {
        var t = block.trim();
        if (idx === 0 && t.startsWith("---")) {
          return { index: idx, author: "human", ts: ts, preview: t.substring(0, 60).replace(/\n/g, " ") };
        }
        if (t.startsWith("Chat with meeting transcript:")) {
          return { index: idx, author: "human", ts: ts, preview: t.substring(0, 60) };
        }
        return { index: idx, author: "ai", ts: ts, preview: t.substring(0, 60).replace(/\n/g, " ") };
      })
    };
  }
};

// ─── In-memory provenance state ────────────────────────────────────────────

var s = { data: new Map(), enabled: true, currentFile: null };

// ─── CodeMirror Decoration ─────────────────────────────────────────────────

var d = require("@codemirror/view");
var x = require("@codemirror/state");

function buildDecorations(view) {
  if (!s.enabled || !s.currentFile) return d.Decoration.none;
  var prov = s.data.get(s.currentFile);
  if (!prov || !prov.blocks || prov.blocks.length === 0) return d.Decoration.none;

  var builder = new x.RangeSetBuilder();
  var doc = view.state.doc;
  var text = doc.toString();

  // Decorations operate on body only; frontmatter paragraphs are not tracked.
  var bStart = bodyStart(text);
  var body = text.substring(bStart);
  var blocks = body.split(/\n\n+/);
  var pos = 0;

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var blockDocStart = bStart + pos;
    var blockDocEnd = bStart + pos + block.length;
    var meta = prov.blocks[i];

    if (meta && meta.author === "ai") {
      var startLine = doc.lineAt(Math.min(blockDocStart, doc.length));
      var endLine = doc.lineAt(Math.min(Math.max(blockDocEnd - 1, startLine.from), doc.length));
      for (var ln = startLine.number; ln <= endLine.number; ln++) {
        var line = doc.line(ln);
        builder.add(line.from, line.from, d.Decoration.line({ class: "provenance-ai-block" }));
      }
    }

    pos += block.length;
    var gap = body.substring(pos).match(/^\n\n+/);
    if (gap) pos += gap[0].length;
  }

  return builder.finish();
}

var D = d.ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = buildDecorations(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: function(v) { return v.decorations; } }
);

// ─── Settings Tab ──────────────────────────────────────────────────────────

var p = require("obsidian");

var SettingsTab = class extends p.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    var el = this.containerEl;
    el.empty();
    el.createEl("h2", { text: "Provenance Settings" });

    new p.Setting(el)
      .setName("Enable tracking")
      .setDesc("Track which text was written by AI vs human")
      .addToggle(function(toggle) {
        toggle.setValue(this.plugin.settings.enabled).onChange(async function(val) {
          this.plugin.settings.enabled = val;
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new p.Setting(el)
      .setName("Enable highlighting")
      .setDesc("Show visual highlighting on AI-authored blocks")
      .addToggle(function(toggle) {
        toggle.setValue(this.plugin.settings.highlightEnabled).onChange(async function(val) {
          this.plugin.settings.highlightEnabled = val;
          await this.plugin.saveSettings();
          this.plugin.updateHighlighting();
        }.bind(this));
      }.bind(this));

    new p.Setting(el)
      .setName("Storage folder")
      .setDesc("Folder for Snipd/Granola provenance sidecar files (relative to vault root)")
      .addText(function(text) {
        text.setPlaceholder(".provenance")
          .setValue(this.plugin.settings.storageFolder)
          .onChange(async function(val) {
            this.plugin.settings.storageFolder = val || ".provenance";
            await this.plugin.saveSettings();
            this.plugin.store.setStorageFolder(this.plugin.settings.storageFolder);
          }.bind(this));
      }.bind(this));

    el.createEl("h3", { text: "Authorship Format" });
    el.createEl("p", {
      text: "Inspired by iainc/Markdown-Annotations: authorship data lives completely " +
            "separate from your prose — no inline clutter. AI paragraph indices are stored " +
            "in note frontmatter as \"ai_blocks: 2 5 7\" (0-based, body paragraphs only).",
      cls: "setting-item-description"
    });
    var list = el.createEl("ul");
    list.createEl("li", { text: "Regular notes: ai_blocks in frontmatter — use command palette to toggle any block" });
    list.createEl("li", { text: "Granola notes: detected by granola_id — summaries AI, transcript human" });
    list.createEl("li", { text: "Snipd notes: detected by from_snipd — titles/summaries AI, quotes human" });
    list.createEl("li", { text: "Legacy <!-- ai --> markers: auto-migrated to frontmatter on next modify" });

    el.createEl("h3", { text: "Command Palette" });
    el.createEl("p", {
      text: "\"Provenance: Toggle AI authorship for current block\" — place cursor anywhere " +
            "in a paragraph and run the command to mark or unmark it as AI-written.",
      cls: "setting-item-description"
    });
  }
};

// ─── Default Settings ──────────────────────────────────────────────────────

var S = {
  enabled: true,
  highlightEnabled: true,
  storageFolder: ".provenance",
  aiColor: "rgba(99, 155, 255, 0.5)"
};

// ─── Main Plugin ───────────────────────────────────────────────────────────

var w = class extends c.Plugin {
  constructor() {
    super(...arguments);
    this.settings = S;
    this.store = null;
    this.contentCache = new Map();
    this.writingProvenance = false;
    this.statusBarEl = null;
  }

  async onload() {
    await this.loadSettings();
    this.store = new g(this.app.vault, this.settings.storageFolder);
    this.registerEditorExtension([D]);
    this.addSettingTab(new SettingsTab(this.app, this));

    this.addRibbonIcon("eye", "Toggle Provenance Highlighting", () => {
      this.settings.highlightEnabled = !this.settings.highlightEnabled;
      this.saveSettings();
      this.updateHighlighting();
      new c.Notice("Provenance highlighting " + (this.settings.highlightEnabled ? "ON" : "OFF"));
    });

    // Toggle highlighting on/off
    this.addCommand({
      id: "toggle-provenance",
      name: "Toggle Provenance Highlighting",
      callback: () => {
        this.settings.highlightEnabled = !this.settings.highlightEnabled;
        this.saveSettings();
        this.updateHighlighting();
        new c.Notice("Provenance highlighting " + (this.settings.highlightEnabled ? "ON" : "OFF"));
      }
    });

    // Toggle current block as AI-written / human-written
    this.addCommand({
      id: "toggle-ai-block",
      name: "Toggle AI authorship for current block",
      editorCallback: async (editor, view) => {
        if (!view || !view.file) return;
        var file = view.file;

        var content = await this.app.vault.read(file);

        // Resolve cursor offset in the raw document
        var cursor = editor.getCursor();
        var cursorOffset = editor.posToOffset(cursor);

        var blockIdx = blockIdxAtOffset(content, cursorOffset);
        var aiSet = readAiBlocks(content);
        var wasAi = aiSet.has(blockIdx);

        if (wasAi) {
          aiSet.delete(blockIdx);
        } else {
          aiSet.add(blockIdx);
        }

        // If there were legacy markers, strip them too
        var newContent = writeAiBlocks(
          hasLegacyMarkers(content) ? stripLegacyMarkers(content) : content,
          aiSet
        );

        this.writingProvenance = true;
        try {
          await this.app.vault.modify(file, newContent);
          this.contentCache.set(file.path, newContent);
        } finally {
          this.writingProvenance = false;
        }

        var prov = provenanceFromFrontmatter(newContent);
        s.data.set(file.path, prov);
        this.refreshActiveEditor();
        this.updateStatusBar();

        var nowAi = aiSet.has(blockIdx);
        new c.Notice(nowAi ? "Block marked as AI-written" : "Block marked as human-written");
      }
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("");
    new c.Notice("Provenance v" + VERSION + " loaded");

    var self = this;

    this.app.workspace.onLayoutReady(async () => {
      var files = self.app.vault.getMarkdownFiles();
      for (var file of files) {
        if (!self.isProvenanceFile(file.path)) {
          try {
            var content = await self.app.vault.cachedRead(file);
            self.contentCache.set(file.path, content);
          } catch (e) {}
        }
      }
      await self.loadActiveFileProvenance();
    });

    this.registerEvent(this.app.vault.on("modify", async (file) => {
      if (!self.settings.enabled) return;
      if (!(file instanceof c.TFile)) return;
      if (file.extension !== "md") return;
      if (self.isProvenanceFile(file.path)) return;
      if (self.writingProvenance) return;

      var newContent = await self.app.vault.read(file);
      var oldContent = self.contentCache.get(file.path) || "";
      if (oldContent === newContent) return;
      self.contentCache.set(file.path, newContent);

      self.writingProvenance = true;
      try {
        var prov = await self.classifyFile(file, newContent);
        if (prov) s.data.set(file.path, prov);
      } finally {
        self.writingProvenance = false;
      }

      self.refreshActiveEditor();
      self.updateStatusBar();
    }));

    this.registerEvent(this.app.vault.on("create", async (file) => {
      if (file instanceof c.TFile && file.extension === "md" && !self.isProvenanceFile(file.path)) {
        try {
          var content = await self.app.vault.read(file);
          self.contentCache.set(file.path, content);
        } catch (e) {}
      }
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof c.TFile) {
        self.contentCache.delete(file.path);
        s.data.delete(file.path);
      }
    }));

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof c.TFile)) return;
      var cached = self.contentCache.get(oldPath);
      if (cached !== undefined) {
        self.contentCache.delete(oldPath);
        self.contentCache.set(file.path, cached);
      }
      var prov = s.data.get(oldPath);
      if (prov) {
        s.data.delete(oldPath);
        s.data.set(file.path, prov);
      }
    }));

    this.registerEvent(this.app.workspace.on("active-leaf-change", async () => {
      var view = self.app.workspace.getActiveViewOfType(c.MarkdownView);
      if (!view || !view.file) {
        s.currentFile = null;
        self.updateStatusBar();
        return;
      }
      var path = view.file.path;
      s.currentFile = path;
      if (!s.data.has(path)) {
        await self.loadFileProvenance(view.file);
      }
      self.refreshActiveEditor();
      self.updateStatusBar();
    }));
  }

  // ─── Classify a file on modify ───
  async classifyFile(file, content) {
    // Snipd: structural sidecar
    if (g.isSnipd(content)) {
      var prov = g.generateSnipdProvenance(content);
      await this.store.save(file.path, prov);
      return prov;
    }
    // Granola: structural sidecar
    if (g.isGranola(content)) {
      var prov = g.generateGranolaProvenance(content);
      await this.store.save(file.path, prov);
      return prov;
    }
    // Regular file: migrate legacy markers to frontmatter if present
    if (hasLegacyMarkers(content)) {
      var aiSet = readAiBlocks(content); // reads from legacy markers
      var migrated = stripLegacyMarkers(writeAiBlocks(content, aiSet));
      var f = this.app.vault.getAbstractFileByPath(file.path);
      if (f instanceof c.TFile) {
        await this.app.vault.modify(f, migrated);
        this.contentCache.set(file.path, migrated);
      }
      return provenanceFromFrontmatter(migrated);
    }
    return provenanceFromFrontmatter(content);
  }

  // ─── Load provenance when switching to a file ───
  async loadFileProvenance(file) {
    try {
      var content = this.contentCache.get(file.path);
      if (!content) {
        content = await this.app.vault.read(file);
        this.contentCache.set(file.path, content);
      }
      if (g.isSnipd(content)) {
        var prov = await this.store.load(file.path) || g.generateSnipdProvenance(content);
        s.data.set(file.path, prov);
        return;
      }
      if (g.isGranola(content)) {
        var prov = await this.store.load(file.path) || g.generateGranolaProvenance(content);
        s.data.set(file.path, prov);
        return;
      }
      var aiSet = readAiBlocks(content);
      if (aiSet.size > 0) {
        s.data.set(file.path, provenanceFromFrontmatter(content));
      }
    } catch (e) {}
  }

  async loadActiveFileProvenance() {
    var view = this.app.workspace.getActiveViewOfType(c.MarkdownView);
    if (view && view.file) {
      var path = view.file.path;
      s.currentFile = path;
      await this.loadFileProvenance(view.file);
      this.refreshActiveEditor();
      this.updateStatusBar();
    }
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    if (!s.currentFile || !s.data.has(s.currentFile)) {
      this.statusBarEl.setText("");
      return;
    }
    var prov = s.data.get(s.currentFile);
    var count = prov && prov.blocks
      ? prov.blocks.filter(function(b) { return b.author === "ai"; }).length
      : 0;
    this.statusBarEl.setText(count > 0 ? "✦ " + count + " AI block" + (count === 1 ? "" : "s") : "");
  }

  onunload() {
    s.data.clear();
    s.currentFile = null;
  }

  isProvenanceFile(path) {
    return path.startsWith(this.settings.storageFolder + "/");
  }

  updateHighlighting() {
    s.enabled = this.settings.highlightEnabled;
    this.refreshActiveEditor();
  }

  refreshActiveEditor() {
    var view = this.app.workspace.getActiveViewOfType(c.MarkdownView);
    if (!view) return;
    var cm = view.editor && view.editor.cm;
    if (cm && cm.dispatch) cm.dispatch({});
  }

  async loadSettings() {
    this.settings = Object.assign({}, S, await this.loadData());
    s.enabled = this.settings.highlightEnabled;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
