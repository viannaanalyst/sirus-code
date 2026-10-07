import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { WordReader } = await server.ssrLoadModule("/src/components/DocumentReader.tsx");
  const { SheetReader } = await server.ssrLoadModule("/src/components/SheetReader.tsx");
  const { ComposerContextChips } = await server.ssrLoadModule("/src/components/ComposerAddMenu.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { client, SirusClient } = await server.ssrLoadModule("/src/client/index.ts");
  const store = () => useAppStore.getState();
  const settings = store().settings;
  const project = { id: "reader-project", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
  const session = { id: "reader-session", projectId: project.id, title: "Fixture", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null };
  const owner = `project:${project.id}`;
  const file = { id: "attachment", owner, name: "Report.docx", kind: "file", content: "", truncated: false };
  useAppStore.setState({ projects: [project], sessions: [], selectedProjectId: project.id, selectedSessionId: null, composerContexts: { [owner]: { attachments: [file], goal: "", planning: false } }, dockPanes: [] });
  const originalRelease = client.releasePromptAttachments;
  const released = [];
  client.releasePromptAttachments = async (key, ids) => { released.push({ key, ids }); };
  // Attachments open in the centered modal (after T3 Code), never in a new session or dock tab.
  store().openAttachmentReader(owner, file);
  assert.deepEqual(store().attachmentModal, { scope: owner, attachmentId: file.id });
  assert.equal(store().selectedSessionId, null, "Opening a reader must not create a session");
  assert.equal(store().dockPanes.length, 0);
  store().closeAttachmentModal();
  store().openAttachmentReader("project:foreign", file);
  store().openAttachmentReader(owner, { ...file, id: "unadmitted" });
  assert.equal(store().attachmentModal, null, "foreign owners and unadmitted files never open");
  // A dock reader pane from before still closes with its attachment.
  useAppStore.setState({ dockPanes: [{ id: "reader-pane", kind: "document", document: { owner, scope: owner, attachmentId: file.id, name: file.name } }], dockActivePaneId: "reader-pane", dockOpen: true });
  const originalPane = store().dockPanes[0];
  for (const locale of ["pt-BR", "en"]) {
    // SSR uses the initial store snapshot, matching the existing verification scripts.
    useAppStore.getInitialState().settings = { ...settings, locale };
    const word = renderToString(createElement(WordReader, { zoom: 1, blocks: [
      { type: "paragraph", heading: 1, list: false, text: "Overview" },
      { type: "paragraph", heading: 0, list: false, text: "<script>alert(1)</script>" },
      { type: "table", rows: [["Name", "Value"], ["<img src='https://evil'>", "42"]] },
    ] }));
    assert.ok(word.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!word.includes("<script>") && !word.includes("<img"));
    assert.ok(word.includes('aria-level="1"') && word.includes("<table"));
    const sheet = renderToString(createElement(SheetReader, { zoom: 1, sheets: [{ name: "Resumo", rows: 5000, columns: 3, cells: [{ row: 0, column: 0, value: "<script>evil()</script>", formula: "SUM(B1:C1)" }] }] }));
    assert.ok(sheet.includes("=SUM(B1:C1)") && sheet.includes("&lt;script&gt;evil()&lt;/script&gt;"));
    assert.equal((sheet.match(/scope="row"/g) ?? []).length, 60, "Large grids only render a bounded row window");
    const chips = renderToString(createElement(ComposerContextChips, { owner, context: { attachments: [file], goal: "", planning: false }, disabled: false, planningAvailable: true, onChange() {} }));
    assert.ok(chips.includes(locale === "en" ? "Read Report.docx" : "Ler Report.docx"));
  }
  const originalCreate = client.createSession, originalSend = client.sendPrompt, originalDraft = client.saveComposerDraft;
  client.createSession = async () => session;
  client.sendPrompt = async () => session;
  client.saveComposerDraft = async () => {};
  try {
    assert.equal(await store().sendPrompt("Read the attachment"), true);
    assert.equal(store().dockPanes[0].document.scope, `session:${session.id}`);
    assert.equal(store().dockPanes[0].document.owner, owner, "Transfer changes visible scope, never native snapshot ownership");
    assert.equal(store().dockPanes[0].id, originalPane.id);
    assert.equal(released.length, 0, "Sending does not release the reader's admitted snapshot");
  } finally { client.createSession = originalCreate; client.sendPrompt = originalSend; client.saveComposerDraft = originalDraft; }
  useAppStore.setState({ selectedSessionId: null, composerContexts: { [owner]: { attachments: [file], goal: "", planning: false } }, dockPanes: [] });
  store().openAttachmentReader(owner, file);
  store().setComposerContext(owner, { attachments: [], goal: "", planning: false });
  assert.equal(store().dockPanes.length, 0, "Removing an unsent attachment closes its reader");
  assert.deepEqual(released[0], { key: owner, ids: [file.id] });
  for (let i = 0; i < 9; i++) {
    const next = { ...file, id: `attachment-${i}` };
    useAppStore.setState({ composerContexts: { [owner]: { attachments: [next], goal: "", planning: false } } });
    store().openAttachmentReader(owner, next);
  }
  assert.equal(store().attachmentModal.attachmentId, "attachment-8", "the modal shows the attachment opened last");
  assert.equal(store().dockPanes.length, 0);
  client.releasePromptAttachments = originalRelease;
  const calls = [];
  const api = new SirusClient({ invoke: async (command, args) => { calls.push({ command, args }); return { type: "word", blocks: [] }; }, listen: async () => () => {} });
  await api.attachmentPreview(owner, file.id);
  assert.deepEqual(calls, [{ command: "attachment_preview", args: { owner, id: file.id } }]);
  console.log("Document reader: safe Word/sheet/chip rendering in both locales, virtual rows, opaque IPC, landing, transfer, removal and the attachment modal passed");
} finally { await server.close(); }

// Render an actual two-page PDF using the same bundled PDF.js display and worker.
// This is a parser/canvas unit check, not browser automation.
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const stream = (text) => { const code = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET\n`; return `<< /Length ${Buffer.byteLength(code)} >>\nstream\n${code}endstream`; };
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  stream("Sirus Code attachment reader"),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  stream("Second document page"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let source = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(source)); source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
const xref = Buffer.byteLength(source);
source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = getDocument({ data: Uint8Array.from(Buffer.from(source)), disableFontFace: true, useSystemFonts: false, useWasm: false, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` });
try {
  const doc = await pdf.promise;
  assert.equal(doc.numPages, 2);
  for (const number of [1, 2]) {
    const page = await doc.getPage(number);
    const text = await page.getTextContent();
    assert.ok(text.items.some((item) => "str" in item && item.str.includes(number === 1 ? "Sirus Code" : "Second")));
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    assert.ok(pixels.some((value, i) => i % 4 !== 3 && value < 100), "PDF page must contain rendered text pixels");
    page.cleanup();
  }
  console.log("PDF.js: real two-page PDF text extraction and raster rendering with bundled fonts passed");
} finally { await pdf.destroy(); }
