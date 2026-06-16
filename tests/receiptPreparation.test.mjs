import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.tmp-tests');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync(
  process.execPath,
  [
    resolve(root, 'node_modules/typescript/bin/tsc'),
    'components/receiptPreparation.ts',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--outDir',
    outDir,
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'pipe' }
);

const { prepareReceiptDataUrls } = await import(pathToFileURL(resolve(outDir, 'receiptPreparation.js')).href);

const originalPdf = 'data:application/pdf;base64,JVBERi0xLjQKcGRm';
const renderedAllPages = 'data:image/jpeg;base64,all-pages';

const pdfResult = await prepareReceiptDataUrls({
  fileType: 'application/pdf',
  dataUrl: originalPdf,
  renderPdfForAnalysis: async () => renderedAllPages,
  compressImage: async (value) => `compressed:${value}`,
});

assert.equal(pdfResult.safeDataUrl, originalPdf);
assert.equal(pdfResult.aiInputDataUrl, renderedAllPages);

const originalImage = 'data:image/png;base64,iVBORw0KGgo=';
const imageResult = await prepareReceiptDataUrls({
  fileType: 'image/png',
  dataUrl: originalImage,
  renderPdfForAnalysis: async () => {
    throw new Error('PDF renderer should not be called for images');
  },
  compressImage: async (value) => `compressed:${value}`,
});

assert.equal(imageResult.safeDataUrl, `compressed:${originalImage}`);
assert.equal(imageResult.aiInputDataUrl, `compressed:${originalImage}`);

rmSync(outDir, { recursive: true, force: true });
