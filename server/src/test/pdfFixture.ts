/**
 * Testler icin metin katmanli, gecerli bir minimal PDF uretir.
 *
 * Gercek banka ekstreleri kisisel finansal veridir ve repoya konamaz
 * (bkz. .gitignore). Bu uretec sayesinde OCR hattinin metin katmani yolu
 * (pdfjs -> ayristirici -> taslak) gercek bir PDF ile uctan uca test edilebilir.
 */
export function buildTextPdf(lines: string[]): Buffer {
  const escaped = lines.map((line) => line.replace(/([\\()])/g, '\\$1'));

  const content =
    'BT\n/F1 10 Tf\n14 TL\n40 750 Td\n' +
    escaped.map((line) => `(${line}) Tj\nT*\n`).join('') +
    'ET\n';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
