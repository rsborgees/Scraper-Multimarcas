const puppeteer = require('puppeteer');
require('dotenv').config();

async function ultraScan() {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const skus = ['930625445', '930847582', '930754968'];
    
    console.log(`🔍 [UltraScan] Buscando SKUs ${skus.join(', ')} no Drive...`);
    
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        // Intensive scrolling to load virtual lists
        for (let i = 0; i < 20; i++) {
            await page.evaluate(() => window.scrollBy(0, 2000));
            await new Promise(r => setTimeout(r, 1000));
        }

        const results = await page.evaluate((skus) => {
            const found = [];
            // Procurar em cada célula de linha/tabela do Drive
            const rows = document.querySelectorAll('div[role="row"], div[jslog], div[data-id]');
            
            rows.forEach(row => {
                const text = row.innerText || '';
                skus.forEach(s => {
                    if (text.includes(s)) {
                        const driveId = row.getAttribute('data-id') || 
                                        row.querySelector('a[href*="/file/d/"]')?.href?.match(/\/file\/d\/([^/]+)/)?.[1];
                        
                        found.push({
                            sku: s,
                            fileName: text.split('\n')[0],
                            driveId: driveId || 'NOT_FOUND'
                        });
                    }
                });
            });

            // Se ainda não achou, faz uma varredura global bruta
            if (found.length === 0) {
                 document.querySelectorAll('*').forEach(el => {
                    if (el.children.length === 0) {
                        const t = el.innerText || '';
                        skus.forEach(s => {
                            if (t.includes(s)) {
                                found.push({ sku: s, text: t, note: 'Brute search found' });
                            }
                        });
                    }
                 });
            }

            return found;
        }, skus);

        console.log(`📊 Scan finalizado. Resultados: ${results.length}`);
        console.log(JSON.stringify(results, null, 2));

        if (results.length > 0) {
            console.log("💎 Itens encontrados! Verificando IDs...");
        }

    } catch (e) {
        console.error("💥 Erro no UltraScan:", e.message);
    } finally {
        await browser.close();
    }
}

ultraScan();
