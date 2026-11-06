// Run: npm run inspect  - opens a visible browser and prints what it finds on each page.
process.env.HEADLESS = 'false';
const { config } = await import('./config');
const { openPage, closeBrowser } = await import('./scraper');

for (const path of [config.pages.multiservices, config.pages.bill]) {
  const page = await openPage(path);
  const info = await page.evaluate(() => {
    const t = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
    return {
      selects: Array.from(document.querySelectorAll('select')).map((s) => ({
        name: s.name, id: s.id, options: Array.from(s.options).map((o) => `${o.text.trim()} [${o.value}]`),
      })),
      inputs: Array.from(document.querySelectorAll('input')).map((i) => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder })),
      buttons: Array.from(document.querySelectorAll('button, input[type=submit]')).map((b) => t(b.textContent || (b as HTMLInputElement).value)),
      tables: Array.from(document.querySelectorAll('table')).map((tb) => Array.from(tb.querySelectorAll('th')).map((h) => t(h.textContent))),
    };
  });
  console.log(`\n===== ${path} =====`);
  console.dir(info, { depth: 5, maxArrayLength: 40 });
  await page.close();
}
await closeBrowser();
