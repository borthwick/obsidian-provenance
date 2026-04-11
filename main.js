var y = Object.defineProperty;
var V = Object.getOwnPropertyDescriptor;
var B = Object.getOwnPropertyNames;
var M = Object.prototype.hasOwnProperty;
var N = (a, i) => { for (var t in i) y(a, t, { get: i[t], enumerable: true }); };
var O = (a, i, t, e) => {
  if (i && typeof i == "object" || typeof i == "function")
    for (let n of B(i))
      if (!M.call(a, n) && n !== t)
        y(a, n, { get: () => i[n], enumerable: !(e = V(i, n)) || e.enumerable });
  return a;
};
var H = (a) => O(y({}, "__esModule", { value: true }), a);
var I = {};
N(I, { default: () => w });
module.exports = H(I);

var c = require("obsidian");
var v = require("obsidian");

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
      try {
        var content = await this.vault.read(f);
        return JSON.parse(content);
      } catch (e) { return null; }
    }
    try {
      var exists = await this.vault.adapter.exists(provPath);
      if (exists) {
        var content = await this.vault.adapter.read(provPath);
        return JSON.parse(content);
      }
    } catch (e) {}
    return null;
  }

  async save(filePath, data) {
    var provPath = this.getProvenancePath(filePath);
    var json = JSON.stringify(data, null, 2);
    var dir = provPath.substring(0, provPath.lastIndexOf("/"));
    if (dir) {
      if (!this.vault.getAbstractFileByPath(dir)) {
        await this.vault.createFolder(dir).catch(() => {});
      }
    }
    var existing = this.vault.getAbstractFileByPath(provPath);
    if (existing && existing instanceof v.TFile) {
      await this.vault.modify(existing, json);
    } else {
      await this.vault.create(provPath, json);
    }
  }

  static splitBlocks(text) {
    return text.split(/\n\n+/);
  }

  static diffBlocks(oldBlocks, newBlocks) {
    var changed = new Set();
    for (var i = 0; i < newBlocks.length; i++) {
      if (i >= oldBlocks.length || oldBlocks[i] !== newBlocks[i]) changed.add(i);
    }
    return changed;
  }

  static isSnipd(content) {
    var m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return false;
    return /from_snipd:\s*true/m.test(m[1]);
  }

  static classifySnipBlock(block, inTranscript) {
    var trimmed = block.trim();
    if (!trimmed) return "human";
    if (trimmed.startsWith("---")) return "human";
    if (trimmed.startsWith(">")) return "human";
    if (/^\*\*[^*]+:\*\*/.test(trimmed)) return inTranscript ? "human" : "ai";
    if (trimmed.startsWith("<iframe")) return "human";
    if (trimmed.startsWith("![") || trimmed.startsWith("# ") || trimmed.startsWith("## Episode")) return "human";
    if (/^#{2,3}\s/.test(trimmed)) {
      if (/Transcript/i.test(trimmed) || /Quote/i.test(trimmed)) return "human";
      return "ai";
    }
    if (trimmed.startsWith("\uD83C\uDFA7")) return "human";
    if (/^-\s/.test(trimmed)) return "ai";
    if (trimmed.startsWith("```")) return "human";
    return inTranscript ? "human" : "ai";
  }

  static generateSnipdProvenance(content) {
    var blocks = g.splitBlocks(content);
    var ts = new Date().toISOString();
    var inTranscript = false;
    var result = {
      version: 1,
      blocks: blocks.map(function(block, idx) {
        var trimmed = block.trim();
        if (/Transcript/i.test(trimmed)) {
          inTranscript = true;
        } else if (/^#{2,3}\s/.test(trimmed) && !/Transcript/i.test(trimmed) && !/Quote/i.test(trimmed)) {
          inTranscript = false;
        }
        var author = g.classifySnipBlock(block, inTranscript);
        return {
          index: idx,
          author: author,
          ts: ts,
          preview: block.substring(0, 60).replace(/\n/g, " ")
        };
      })
    };
    return result;
  }

  async updateProvenance(filePath, oldContent, newContent, author) {
    var existing = await this.load(filePath);
    var oldBlocks = g.splitBlocks(oldContent);
    var newBlocks = g.splitBlocks(newContent);
    var changed = g.diffBlocks(oldBlocks, newBlocks);
    var ts = new Date().toISOString();
    var result = {
      version: 1,
      blocks: newBlocks.map(function(block, idx) {
        if (changed.has(idx)) {
          return { index: idx, author: author, ts: ts, preview: block.substring(0, 60).replace(/\n/g, " ") };
        }
        if (existing && existing.blocks[idx]) {
          return Object.assign({}, existing.blocks[idx], { index: idx });
        }
        return { index: idx, author: "human", ts: ts, preview: block.substring(0, 60).replace(/\n/g, " ") };
      })
    };
    await this.save(filePath, result);
    return result;
  }
};

var d = require("@codemirror/view");
var x = require("@codemirror/state");

var s = { data: new Map(), enabled: true, currentFile: null };

function T(view) {
  if (!s.enabled || !s.currentFile) return d.Decoration.none;
  var prov = s.data.get(s.currentFile);
  if (!prov || prov.blocks.length === 0) return d.Decoration.none;

  var builder = new x.RangeSetBuilder();
  var doc = view.state.doc;
  var text = doc.toString();
  var blocks = text.split(/\n\n+/);
  var pos = 0;

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var start = pos;
    var end = pos + block.length;
    var meta = prov.blocks[i];

    if (meta && meta.author === "ai") {
      var startLine = doc.lineAt(Math.min(start, doc.length));
      var endLine = doc.lineAt(Math.min(Math.max(end - 1, 0), doc.length));
      for (var ln = startLine.number; ln <= endLine.number; ln++) {
        var line = doc.line(ln);
        builder.add(line.from, line.from, d.Decoration.line({ class: "provenance-ai-block" }));
      }
    }

    pos = end;
    var gap = text.substring(pos).match(/^\n\n+/);
    if (gap) pos += gap[0].length;
  }

  return builder.finish();
}

var D = d.ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = T(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
        this.decorations = T(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

var p = require("obsidian");

var m = class extends p.PluginSettingTab {
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
      .setDesc("Folder name for provenance sidecar files (relative to vault root)")
      .addText(function(text) {
        text.setPlaceholder(".provenance")
          .setValue(this.plugin.settings.storageFolder)
          .onChange(async function(val) {
            this.plugin.settings.storageFolder = val || ".provenance";
            await this.plugin.saveSettings();
            this.plugin.store.setStorageFolder(this.plugin.settings.storageFolder);
          }.bind(this));
      }.bind(this));
  }
};

var S = {
  enabled: true,
  highlightEnabled: true,
  storageFolder: ".provenance",
  aiColor: "rgba(99, 155, 255, 0.5)"
};

var w = class extends c.Plugin {
  constructor() {
    super(...arguments);
    this.settings = S;
    this.store = null;
    this.contentCache = new Map();
    this.editorDirtyFiles = new Set();
    this.editorEditTimers = new Map();
    this.writingProvenance = false;
    this.statusBarEl = null;
    this.fileCreateTimes = new Map();
  }

  async onload() {
    await this.loadSettings();
    this.store = new g(this.app.vault, this.settings.storageFolder);
    this.registerEditorExtension([D]);
    this.addSettingTab(new m(this.app, this));

    this.addRibbonIcon("eye", "Toggle Provenance Highlighting", () => {
      this.settings.highlightEnabled = !this.settings.highlightEnabled;
      this.saveSettings();
      this.updateHighlighting();
      new c.Notice("Provenance highlighting " + (this.settings.highlightEnabled ? "ON" : "OFF"));
    });

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

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("Provenance v1.2.3");
    new c.Notice("Provenance v1.2.3 loaded");

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
      new c.Notice("Cache: " + self.contentCache.size + " files, current: " + (s.currentFile || "none"));
      var aiCount = 0;
      if (s.currentFile && s.data.has(s.currentFile)) {
        aiCount = s.data.get(s.currentFile).blocks.filter(function(b){return b.author==="ai"}).length;
      }
      new c.Notice("Provenance data loaded: " + s.data.size + " files, AI blocks: " + aiCount);
    });

    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => {
      if (!self.settings.enabled) return;
      var file = info.file;
      if (!file || self.isProvenanceFile(file.path)) return;
      self.editorDirtyFiles.add(file.path);
      var timer = self.editorEditTimers.get(file.path);
      if (timer) clearTimeout(timer);
      self.editorEditTimers.set(file.path, setTimeout(() => {
        self.editorDirtyFiles.delete(file.path);
        self.editorEditTimers.delete(file.path);
      }, 500));
    }));

    this.registerEvent(this.app.vault.on("modify", async (file) => {
      if (!self.settings.enabled) return;
      if (!(file instanceof c.TFile)) return;
      if (file.extension !== "md") return;
      if (self.isProvenanceFile(file.path)) return;
      if (self.writingProvenance) return;

      var newContent = await self.app.vault.read(file);
      var oldContent = self.contentCache.get(file.path) || "";
      if (oldContent === newContent) return;

      var createTime = self.fileCreateTimes.get(file.path);
      var author;
      if (self.editorDirtyFiles.has(file.path)) {
        author = "human";
      } else if (createTime && Date.now() - createTime < 3000) {
        author = "human";
      } else {
        author = "ai";
      }

      self.writingProvenance = true;
      try {
        var prov = await self.store.updateProvenance(file.path, oldContent, newContent, author);
        s.data.set(file.path, prov);
      } finally {
        self.writingProvenance = false;
      }
      self.contentCache.set(file.path, newContent);
      self.refreshActiveEditor();
      self.updateStatusBar();
    }));

    this.registerEvent(this.app.vault.on("create", async (file) => {
      if (file instanceof c.TFile && file.extension === "md" && !self.isProvenanceFile(file.path)) {
        self.fileCreateTimes.set(file.path, Date.now());
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
        var prov = await self.store.load(path);
        new c.Notice("Leaf change: " + path.substring(path.lastIndexOf("/")+1) + " sidecar: " + (prov ? prov.blocks.length + " blocks" : "none"));
        if (!prov) {
          prov = await self.tryStructuralProvenance(path);
        }
        if (prov) s.data.set(path, prov);
      }
      self.refreshActiveEditor();
      self.updateStatusBar();
    }));
  }

  async tryStructuralProvenance(filePath) {
    try {
      var file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof c.TFile)) return null;
      var content = await this.app.vault.read(file);
      if (!g.isSnipd(content)) return null;
      var prov = g.generateSnipdProvenance(content);
      await this.store.save(filePath, prov);
      return prov;
    } catch (e) { return null; }
  }

  async loadActiveFileProvenance() {
    var view = this.app.workspace.getActiveViewOfType(c.MarkdownView);
    if (view && view.file) {
      var path = view.file.path;
      s.currentFile = path;
      if (!s.data.has(path)) {
        var prov = await this.store.load(path);
        if (!prov) {
          prov = await this.tryStructuralProvenance(path);
        }
        if (prov) s.data.set(path, prov);
      }
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
    var count = prov && prov.blocks ? prov.blocks.filter(function(b) { return b.author === "ai"; }).length : 0;
    this.statusBarEl.setText(count > 0 ? "\u2726 " + count + " AI block" + (count === 1 ? "" : "s") : "");
  }

  onunload() {
    for (var timer of this.editorEditTimers.values()) clearTimeout(timer);
    this.editorEditTimers.clear();
    s.data.clear();
    s.currentFile = null;
    this.fileCreateTimes.clear();
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
